import { glyphAtlas, glyph, graphemes } from './glyphs.js'

const CAPACITY = 8192, STRIDE = 17, BYTE_STRIDE = STRIDE * 4
const shader = /* wgsl */`
struct Globals { viewport: vec4<f32>, covers: array<vec4<f32>, 4> }
@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var fontAtlas: texture_2d<f32>;
@group(0) @binding(2) var fontSampler: sampler;
struct VertexInput {
  @builtin(vertex_index) vertex: u32,
  @location(0) rect: vec4<f32>, @location(1) tile: vec4<f32>,
  @location(2) tint: vec4<f32>, @location(3) clip: vec4<f32>,
  @location(4) mask: f32
}
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>, @location(1) point: vec2<f32>,
  @location(2) local: vec2<f32>, @location(3) @interpolate(flat) tint: vec4<f32>,
  @location(4) @interpolate(flat) clip: vec4<f32>,
  @location(5) @interpolate(flat) shape: vec3<f32>,
  @location(6) @interpolate(flat) mask: u32
}
@vertex fn vertexMain(input: VertexInput) -> VertexOutput {
  let corners = array<vec2<f32>, 6>(vec2(0.,0.),vec2(1.,0.),vec2(1.,1.),vec2(0.,0.),vec2(1.,1.),vec2(0.,1.));
  let local = corners[input.vertex];
  let point = input.rect.xy + local * input.rect.zw;
  var output: VertexOutput;
  output.position = vec4(point.x / globals.viewport.x * 2. - 1., 1. - point.y / globals.viewport.y * 2., 0., 1.);
  output.uv = input.tile.xy + local * input.tile.zw;
  output.point = point; output.local = local; output.tint = input.tint;
  output.clip = input.clip; output.shape = vec3(input.rect.zw, input.tile.x);
  output.mask = u32(input.mask);
  return output;
}
fn clipped(input: VertexOutput) -> bool {
  if (any(input.point < input.clip.xy) || any(input.point > input.clip.zw)) { return true; }
  for (var i = 0u; i < 4u; i++) {
    if ((input.mask & (1u << i)) != 0u && all(input.point >= globals.covers[i].xy) && all(input.point <= globals.covers[i].zw)) { return true; }
  }
  return false;
}
@fragment fn glyphMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let distance = textureSample(fontAtlas, fontSampler, input.uv).r;
  let width = max(fwidth(distance) * .8, .006);
  let alpha = smoothstep(.5 - width, .5 + width, distance) * input.tint.a;
  if (clipped(input) || alpha < .01) { discard; }
  return vec4(input.tint.rgb, alpha);
}
@fragment fn panelMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let radius = input.shape.z;
  let q = abs((input.local - .5) * input.shape.xy) - input.shape.xy * .5 + radius;
  let distance = length(max(q, vec2(0.))) + min(max(q.x, q.y), 0.) - radius;
  let alpha = (1. - smoothstep(-1., 1., distance)) * input.tint.a;
  if (clipped(input)) { discard; }
  return vec4(input.tint.rgb, alpha);
}`

// WebGPU only. The scene renderer has its own context; no Three.js renderer is
// used for glyphs, selections, carets or world label panels.
export async function createGlyphLayer(canvas, onLost) {
  if (!navigator.gpu) throw new Error('WebGPU is unavailable in this browser')
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter) throw new Error('No WebGPU adapter is available')
  const device = await adapter.requestDevice({ label: 'Campfire glyph device' })
  const context = canvas.getContext('webgpu'), format = navigator.gpu.getPreferredCanvasFormat()
  if (!context) { device.destroy(); throw new Error('Could not create the WebGPU glyph canvas') }
  let lost = false
  window.__gpuTextErrors = []
  device.addEventListener('uncapturederror', event => {
    window.__gpuTextErrors.push(event.error.message); console.error('WebGPU glyphs:', event.error.message)
  })
  device.lost.then(info => { lost = true; if (info.reason !== 'destroyed') onLost?.(info.message) })
  const uniform = device.createBuffer({ label: 'Glyph viewport and panel covers', size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const texture = device.createTexture({ label: 'Shared R8 SDF glyph atlas', size: [glyphAtlas.size, glyphAtlas.size], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' })
  const layout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
  ] })
  const bindGroup = device.createBindGroup({ layout, entries: [
    { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: texture.createView() }, { binding: 2, resource: sampler },
  ] })
  const module = device.createShaderModule({ label: 'Campfire SDF glyphs and rounded panels (WGSL)', code: shader })
  const compilation = await module.getCompilationInfo()
  const errors = compilation.messages.filter(message => message.type === 'error')
  if (errors.length) { device.destroy(); throw new Error(errors.map(message => message.message).join('\n')) }
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const vertices = [{ arrayStride: BYTE_STRIDE, stepMode: 'instance', attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' },
    { shaderLocation: 2, offset: 32, format: 'float32x4' }, { shaderLocation: 3, offset: 48, format: 'float32x4' },
    { shaderLocation: 4, offset: 64, format: 'float32' },
  ] }]
  const blend = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } }
  const pipeline = (entryPoint, targetFormat) => device.createRenderPipelineAsync({ label: 'Campfire ' + entryPoint, layout: pipelineLayout,
    vertex: { module, entryPoint: 'vertexMain', buffers: vertices }, fragment: { module, entryPoint, targets: [{ format: targetFormat, blend }] }, primitive: { topology: 'triangle-list' } })
  const [lettersPipeline, panelsPipeline] = await Promise.all([pipeline('glyphMain', format), pipeline('panelMain', format)])
  let readbackPipelines
  function batch(label) {
    const data = new Float32Array(CAPACITY * STRIDE)
    const buffer = device.createBuffer({ label, size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    return { data, buffer, count: 0, push(rect, tile, tint, clip, mask) {
      if (this.count >= CAPACITY) return
      const offset = this.count++ * STRIDE
      data.set(rect, offset); data.set(tile, offset + 4); data.set(tint, offset + 8)
      data.set(clip || [0, 0, width, height], offset + 12); data[offset + 16] = mask
    }, upload() { if (this.count) device.queue.writeBuffer(buffer, 0, data, 0, this.count * STRIDE) } }
  }
  const letters = batch('Instanced glyph quads'), panels = batch('Instanced label panels and editing marks')
  const globals = new Float32Array(20)
  let width = innerWidth, height = innerHeight, atlasRevision = -1
  function upload() {
    globals[0] = width; globals[1] = height
    device.queue.writeBuffer(uniform, 0, globals)
    if (atlasRevision !== glyphAtlas.revision) {
      device.queue.writeTexture({ texture }, glyphAtlas.bytes, { bytesPerRow: glyphAtlas.size }, [glyphAtlas.size, glyphAtlas.size])
      atlasRevision = glyphAtlas.revision
    }
    panels.upload(); letters.upload()
  }
  function draw(encoder, view, pipelines) {
    const pass = encoder.beginRenderPass({ label: 'Campfire glyph overlay', colorAttachments: [{ view, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }] })
    pass.setBindGroup(0, bindGroup)
    for (const [batch, pipeline] of [[panels, pipelines[1]], [letters, pipelines[0]]]) if (batch.count) {
      pass.setPipeline(pipeline); pass.setVertexBuffer(0, batch.buffer); pass.draw(6, batch.count)
    }
    pass.end()
  }
  const layer = {
    resize(w, h, dpr = Math.min(devicePixelRatio, 2)) {
      width = w; height = h; canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr))
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px'
      context.configure({ device, format, alphaMode: 'premultiplied' })
    },
    begin(w, h) { width = w; height = h; panels.count = letters.count = 0 },
    covers(rects) { for (let i = 0; i < 4; i++) globals.set(rects[i] || [0, 0, 0, 0], 4 + i * 4) },
    panel(x, y, w, h, radius, tint, mask = 0) { panels.push([x, y, w, h], [radius, 0, 0, 0], tint, undefined, mask) },
    letter(char, x, baseline, size, tint, bold = false, clip, mask = 0) {
      if (/^\s+$/u.test(char)) return
      const g = glyph(char, bold), k = size / glyphAtlas.em
      letters.push([x - glyphAtlas.pad * k, baseline - glyphAtlas.baseline * k, glyphAtlas.cell * k, glyphAtlas.cell * k], g.uv, tint, clip, mask)
    },
    text(text, x, baseline, size, tint, bold = false, clip, mask = 0) {
      for (const char of graphemes(text)) { this.letter(char, x, baseline, size, tint, bold, clip, mask); x += glyph(char, bold).advance * size }
    },
    render() {
      if (lost) return { backend: 'webgpu-lost', drawCalls: 0 }
      const dpr=Math.min(devicePixelRatio,2)
      if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr))this.resize(width,height,dpr)
      upload()
      const encoder = device.createCommandEncoder({ label: 'Campfire glyph frame' })
      draw(encoder, context.getCurrentTexture().createView(), [lettersPipeline, panelsPipeline]); device.queue.submit([encoder.finish()])
      return { backend: 'webgpu', glyphsDrawn: letters.count, panelsDrawn: panels.count, atlasGlyphs: glyphAtlas.count, atlasBytes: glyphAtlas.bytes.length,
        drawCalls: Number(letters.count > 0) + Number(panels.count > 0), adapter: adapter.info?.description || adapter.info?.vendor || 'WebGPU adapter' }
    },
    async readPixels() {
      readbackPipelines ||= Promise.all([pipeline('glyphMain', 'rgba8unorm'), pipeline('panelMain', 'rgba8unorm')])
      const pipelines = await readbackPipelines, rowBytes = Math.ceil(width * 4 / 256) * 256
      const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
      const buffer = device.createBuffer({ size: rowBytes * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      try {
        upload(); const encoder = device.createCommandEncoder()
        draw(encoder, target.createView(), pipelines)
        encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow: rowBytes }, [width, height]); device.queue.submit([encoder.finish()])
        await buffer.mapAsync(GPUMapMode.READ)
        const pixels = new Uint8Array(buffer.getMappedRange())
        let titlePixels = 0, antialiasPixels = 0, total = 0
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const alpha = pixels[y * rowBytes + x * 4 + 3]
          if (alpha > 0) { total++; if (alpha < 230) antialiasPixels++; if (x > 65 && x < 250 && y < 110) titlePixels++ }
        }
        return { backend: 'webgpu', titlePixels, antialiasPixels, total }
      } finally { buffer.unmap(); buffer.destroy(); target.destroy() }
    },
    dispose() { context.unconfigure(); texture.destroy(); uniform.destroy(); panels.buffer.destroy(); letters.buffer.destroy(); device.destroy() },
  }
  layer.resize(width, height)
  return layer
}
