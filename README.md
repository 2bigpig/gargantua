# Gargantua Black Hole · 卡冈图雅黑洞

受《星际穿越》**Interstellar** 启发的实时 4K 黑洞动画：右侧巨幅裁切、粗犷吸积盘、暖白光线与缓慢移动镜头。纯画面，无文字、按钮或字体资源。

[在线实时预览](https://2bigpig.github.io/gargantua/) · [下载离线 HTML](https://github.com/2bigpig/gargantua/releases/download/v0.2.0/gargantua.html) · [DSH 插件](https://github.com/2bigpig/dsh-gargantua) · [English](README.en.md)

![Gargantua 实际运行演示](docs/demo.gif)

动图为压缩录屏。在线及离线动画均固定实际 **3840×2160** 绘制。

## 直接观看

点击在线预览即可观看，无需安装。也可从 [v0.2.0 Release](https://github.com/2bigpig/gargantua/releases/tag/v0.2.0) 下载 `gargantua.html`，用现代浏览器直接打开，无需服务器、网络或开发依赖。Release 提供 `SHA256SUMS.txt` 校验文件。

建议使用支持 WebGPU 的新版 Chrome、Edge 等浏览器，并启用硬件加速。渲染器也尝试可用的 WebGL 后端；显卡或浏览器无法运行时显示同构图静帧，此时不是动态动画。

- 所有窗口固定 **3840×2160**，按容器显示比例校正射线，不拉伸黑洞。
- 自动持续播放，无暂停、画质切换；不因减少动态效果、隐藏或离屏主动暂停。
- 调度上限 60fps，实际帧率取决于显卡；按真实时间推进，低帧率不减慢流动速度。
- 系统休眠、浏览器冻结、后台调度和显卡故障仍可能中断或限制绘制。

## 从源码构建

需要 Node.js 22+：

```sh
git clone https://github.com/2bigpig/gargantua.git
cd gargantua
npm ci
npm run build
```

生成 `gargantua.html` 与 `dist/gargantua.js`。依赖版本固定，运行时无 CDN 请求；仓库已包含构建结果，直接观看无需构建。

## 嵌入网页

为容器设置明确尺寸，并通过 HTTP(S) 加载模块：

```html
<div id="black-hole" style="width:100%;height:100vh"></div>
<script type="module">
  import { mountGargantua } from './dist/gargantua.js';
  // 每个容器一个实例；组件卸载时调用 destroy() 释放显卡资源。
  const animation = await mountGargantua(document.querySelector('#black-hole'), {
    onState(state) { console.log(state.state); }
  });
  console.log(animation.getStats());
  // animation.resize();  // 需要主动同步尺寸时调用。
  // animation.destroy(); // 页面或组件卸载时调用。
</script>
```

`mountGargantua(container, { onState })` 返回 Promise，解析为 `resize()`、`getStats()`、幂等的 `destroy()`。统计包括实际绘制尺寸、容器尺寸、帧数、动画时间及支持时的 GPU 耗时。0.2.0 不提供播放、暂停或画质覆盖接口。

## 来源与许可

MIT © 2026 **2bigpig**。基于 [dgreenheck/webgpu-black-hole](https://github.com/dgreenheck/webgpu-black-hole)（MIT），使用 Three.js 0.181.1。修改包括粗犷体积气体、吸积盘积分、右侧取景、有界镜头、容器生命周期、固定 4K 和离线打包。见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 [LICENSE](LICENSE)。

受《星际穿越》启发的实时艺术近似，不是电影 DNGR 渲染器，不含电影视频或剧照。配套 [dsh-gargantua](https://github.com/2bigpig/dsh-gargantua) 提供 DeepSeek Harness 会话中栏背景。
