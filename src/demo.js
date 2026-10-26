import { mountGargantua } from './core.js';

// 页面只有画面；实例状态和销毁能力供嵌入与自动验收使用。
mountGargantua(document.querySelector('#scene'), {
  onState(state) { document.documentElement.dataset.state = state.state; }
}).then(controller => { window.gargantua = controller; });
