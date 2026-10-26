import * as THREE from 'three/webgpu';
import { pass, dot, vec3, smoothstep, float } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { BlackHoleSimulation } from './blackhole.js';
import { config } from './config.js';
import desktopPoster from '../assets/desktop.jpg';
import tabletPoster from '../assets/tablet.jpg';
import mobilePoster from '../assets/mobile.jpg';

export const VERSION = '0.2.0';
export const DRAW_WIDTH = 3840;
export const DRAW_HEIGHT = 2160;
const MAX_FPS = 60;
const owners = new WeakMap();

/**
 * 将动画挂载到有明确尺寸的容器。每个容器只有一个实例，不依赖全局页面元素。
 * 固定 3840×2160、持续播放；仅接受 onState 生命周期通知。
 */
export async function mountGargantua(container, options = {}) {
  if (!(container instanceof HTMLElement)) throw new TypeError('container must be an HTMLElement');
  if (owners.has(container)) throw new Error('Gargantua is already mounted in this container');
  const { onState } = options;
  if (onState !== undefined && typeof onState !== 'function') throw new TypeError('onState must be a function');
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const oldPosition = container.style.position;
  const changedPosition = win.getComputedStyle(container).position === 'static';
  if (changedPosition) container.style.position = 'relative';
  const layer = doc.createElement('div');
  layer.dataset.gargantua = VERSION;
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;background:#000;';
  const poster = doc.createElement('img');
  poster.alt = '';
  poster.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
  const canvas = doc.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none;';
  layer.append(poster, canvas);
  container.append(layer);

  let renderer, post, scenePass, glow, simulation, camera;
  let pending = null, disposed = false, failed = false, ready = false;
  let width = 0, height = 0, baseFocalLength = 5.25;
  let raf = 0, previous = 0, elapsed = 0, timestampPending = false;
  const stats = { version: VERSION, state: 'static', ready: false, failed: false, destroyed: false,
    frames: 0, width: 0, height: 0, sceneTime: 0, frameMs: 0, renderMs: 0, gpuMs: null,
    center: [0.92, 0.52], focalLength: 5.25, renderer: '', error: null };
  const getStats = () => ({ ...stats, containerWidth: width, containerHeight: height,
    maxFps: MAX_FPS, center: [...stats.center], rendering: !!raf });
  const notify = () => { layer.dataset.state = stats.state; onState?.(getStats()); };

  function stop() {
    win.cancelAnimationFrame(raf);
    raf = 0;
    previous = 0;
  }

  // 每个实例拥有独立资源；初始化途中销毁时等异步初始化退出后再释放显卡。
  function release() {
    post?.dispose();
    glow?.dispose();
    scenePass?.dispose();
    simulation?.blackHoleMesh?.geometry.dispose();
    simulation?.blackHoleMesh?.material.dispose();
    renderer?.dispose();
    post = glow = scenePass = simulation = renderer = null;
  }

  function fallback(error) {
    if (disposed || failed) return;
    failed = true;
    ready = false;
    stop();
    stats.failed = true;
    stats.ready = false;
    stats.error = String(error?.message || error || 'Rendering unavailable');
    stats.state = 'fallback';
    canvas.style.display = 'none';
    poster.style.display = 'block';
    notify();
  }

  // 固定绘制 4K；射线使用显示容器比例，抵消 CSS 缩放，保持黑洞形状。
  function resize() {
    if (disposed) return;
    const bounds = container.getBoundingClientRect();
    width = Math.max(0, Math.round(bounds.width));
    height = Math.max(0, Math.round(bounds.height));
    const mobile = width <= 700;
    const posterSrc = mobile ? mobilePoster : width < height ? tabletPoster : desktopPoster;
    if (poster.src !== posterSrc) poster.src = posterSrc;
    if (!renderer || !simulation || failed) return;
    const aspect = width > 0 && height > 0 ? width / height : DRAW_WIDTH / DRAW_HEIGHT;
    renderer.setPixelRatio(1);
    renderer.setSize(DRAW_WIDTH, DRAW_HEIGHT, false);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    simulation.onResize(aspect, 1);
    baseFocalLength = 5.25 * Math.min(1, aspect / 1.05);
    simulation.uniforms.screenCenter.value.set(mobile ? 0.96 : 0.92, mobile ? 0.43 : 0.52);
    stats.width = canvas.width;
    stats.height = canvas.height;
    stats.center = simulation.uniforms.screenCenter.value.toArray();
    sync();
  }

  function render(delta) {
    elapsed += delta;
    const phase = elapsed * Math.PI * 2 / 64;
    camera.position.set(Math.sin(phase) * 1.6, 0.65 + Math.sin(phase) * 0.18, 19 - Math.sin(phase));
    camera.lookAt(0, 0, 0);
    simulation.uniforms.cameraRoll.value = 0.11 + Math.sin(phase) * 0.014;
    simulation.uniforms.focalLength.value = baseFocalLength * (1 + 0.035 * Math.sin(phase));
    simulation.update(delta, camera);
    const start = performance.now();
    post.render();
    stats.renderMs = performance.now() - start;
    stats.frames++;
    stats.sceneTime = elapsed;
    stats.focalLength = simulation.uniforms.focalLength.value;
    if (stats.frames % 20 === 0 && renderer.backend.trackTimestamp && !timestampPending) {
      timestampPending = true;
      renderer.backend.resolveTimestampsAsync('render').then(value => {
        if (!disposed && Number.isFinite(value)) stats.gpuMs = value;
      }).catch(() => {}).finally(() => { timestampPending = false; });
    }
  }

  function frame(now) {
    raf = 0;
    if (disposed || failed || !ready) return;
    const interval = previous ? now - previous : 0;
    // 略微容忍浏览器时间戳误差；跳过的帧仍计入下一次实际时间差。
    if (!previous || interval >= 1000 / MAX_FPS - 0.5) {
      previous = now;
      stats.frameMs = interval;
      try { render(interval / 1000); }
      catch (error) { fallback(error); return; }
    }
    raf = win.requestAnimationFrame(frame);
  }

  // 不因页面隐藏、离屏或低动态偏好停止，只在故障和销毁时停止。
  function sync() {
    if (!disposed && !failed && ready && !raf) raf = win.requestAnimationFrame(frame);
  }

  async function initialize() {
    if (disposed || failed || ready) return;
    if (pending) return pending;
    pending = (async () => {
      try {
        stats.state = 'initializing';
        notify();
        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#000');
        camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
        camera.position.set(0, 0.65, 19);
        camera.lookAt(0, 0, 0);
        simulation = new BlackHoleSimulation(scene, config);
        simulation.createBlackHole();
        renderer = new THREE.WebGPURenderer({ canvas, antialias: false, trackTimestamp: true });
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.78;
        await renderer.init();
        if (disposed) return;
        resize();
        scenePass = pass(scene, camera);
        const color = scenePass.getTextureNode();
        glow = bloom(color, 0.48, 0.5, 0.65);
        const lightGate = smoothstep(float(0.015), float(0.16), dot(color.rgb, vec3(0.2126, 0.7152, 0.0722)));
        post = new THREE.PostProcessing(renderer);
        post.outputNode = color.add(glow.mul(lightGate.mul(0.65).add(0.35)));
        await renderer.compileAsync(scene, camera);
        if (disposed) return;
        await post.renderAsync();
        if (disposed) return;
        ready = true;
        stats.ready = true;
        stats.renderer = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
        render(0);
        canvas.style.display = 'block';
        poster.style.display = 'none';
        stats.state = 'live';
        renderer.backend.device?.lost.then(info => fallback(info.message));
        notify();
      } catch (error) { fallback(error); }
      finally { pending = null; if (disposed) release(); else sync(); }
    })();
    return pending;
  }

  const onLost = event => { event.preventDefault(); fallback('Graphics context lost'); };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  canvas.addEventListener('webglcontextlost', onLost);
  win.addEventListener('resize', resize);

  const controller = {
    resize,
    getStats,
    destroy() {
      if (disposed) return;
      disposed = true;
      stop();
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      win.removeEventListener('resize', resize);
      layer.remove();
      if (changedPosition && container.style.position === 'relative') container.style.position = oldPosition;
      owners.delete(container);
      stats.destroyed = true;
      stats.ready = false;
      stats.state = 'destroyed';
      if (!pending) release();
      notify();
    }
  };
  owners.set(container, controller);
  // 所有环境均自动初始化，包括低动态设置与初始隐藏状态。
  resize();
  await initialize();
  notify();
  return controller;
}
