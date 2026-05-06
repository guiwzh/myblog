---
title: 无界（wujie）微前端框架的实现原理
date: 2026-05-07 11:00:00
tags:
  - 微前端
  - wujie
  - 前端架构
categories:
  - 前端
description: 从浏览器底层能力出发，逐层拆解无界（wujie）的技术栈：iframe、Web Components、Shadow DOM、Proxy 代理 document，最终串成一套可落地的微前端方案。
---

> 一个基于 WebComponent 容器 + iframe 沙箱的微前端方案。本文从浏览器底层能力出发，逐层拆解无界的技术栈：iframe、Web Components、Shadow DOM、Proxy 代理 document，最终串成一套可落地的微前端方案。

---

## 一、背景：为什么需要又一个微前端框架

微前端要解决的核心问题就一句话——**在一个 web 应用里独立运行另一个 web 应用**。这件事说起来简单，做起来对一个完善方案的要求很高：

- 子应用要能加载和卸载；
- 子应用之间要能隔离（JS、CSS、DOM 不能互相污染）；
- 子应用的路由要能正常工作（刷新、前进、后退都要 OK）；
- 应用间要能方便通信。

围绕这些诉求，业界已经有几个主流方案，但都各有遗憾。

### 1.1 iframe 方案

直接用 `<iframe>` 嵌入子应用，是最朴素的微前端方案。优点很明显：浏览器原生隔离，JS、CSS、DOM 全部物理隔开，使用零心智成本。但缺点也几乎是致命的：

- **路由状态丢失**：刷新一下，iframe 的 URL 就回到默认页；
- **DOM 割裂严重**：弹窗、modal 只能在 iframe 矩形内展示，无法覆盖整屏；
- **应用间通信困难**：跨域时只能 postMessage，序列化开销大；
- **白屏时间长**：每次打开都是一次完整的浏览器上下文重建。

### 1.2 single-spa / qiankun 方案

qiankun 在 single-spa 基础上做了更完善的封装：HTML entry、JS 沙箱（SnapshotSandbox / LegacySandbox / ProxySandbox）、CSS 沙箱（strictStyleIsolation / experimentalStyleIsolation）、资源预加载等。优点是路由可保持、生态成熟。但仍有几个硬伤：

- **基于路由匹配，无法同时激活多个子应用**，也不支持子应用保活；
- **改造成本较大**：webpack、代码、路由都要做适配；
- **JS 沙箱用 `with(proxyWindow){...}` 包裹代码**，性能下降明显，且不彻底（`history`、`location` 这种原生对象很难拦干净）；
- **CSS 沙箱无法绝对隔离**，scoped 方案对 `:root`、动画 keyframes、字体不友好；
- **无法支持 vite 等基于 ESM 的子应用**——ESM 没有 UMD 那样的全局入口，沙箱拦不住。

### 1.3 无界的思路：用浏览器原生能力代替自行模拟

无界（wujie）由腾讯出品，核心思路是**不要再自行模拟沙箱，浏览器本身就提供了现成的隔离机制**。官方介绍里有一句话基本就是整个方案的核心：

> 将子应用的 js 注入主应用同域的 iframe 中运行，iframe 是一个原生的 window 沙箱，内部有完整的 history 和 location 接口，子应用实例 instance 运行在 iframe 中，路由也彻底和主应用解耦，可以直接在业务组件里面启动应用。

简单说：**JS 沙箱用 iframe，CSS/DOM 沙箱用 Web Component**——把"模拟一个 window"换成"用浏览器送的 window"。

无界由此获得几项独特能力：

- 组件式接入，无需注册路由、改造 webpack；
- 同时激活多个子应用；
- 应用级 keep-alive（保活模式）；
- 副作用局限在 iframe 和 shadowRoot 内部，切换零清理成本；
- 子应用 JS 在 iframe 里直接跑，不用 `with` 包裹，性能接近原生；
- 天然支持 vite。

下面从底层概念逐步拆解。

---

## 二、底层基石：iframe 是天然的 window 沙箱

### 2.1 什么是 window 沙箱

"沙箱"在前端语境里指**一个隔离的代码执行环境**——里面跑的代码不会污染外面，外面也影响不到里面。

具体到 JS，"window 沙箱"意思是：提供一个**独立的 window 对象**给子应用代码使用。为什么要隔离 window？因为浏览器里几乎所有全局状态都挂在 window 上：

- `window.foo = 1` 这种全局变量；
- `setTimeout`、`setInterval` 注册的定时器；
- `addEventListener` 绑的事件；
- `localStorage`、`history`、`location`、`document`；
- 各种库挂的 `window.jQuery`、`window.React` 等。

如果两个子应用都共享主应用的 window，A 子应用写 `window.user = 'A'`、B 子应用写 `window.user = 'B'`，状态就互相覆盖；A 卸载时忘了清的定时器还会继续跑。

### 2.2 iframe 是什么

iframe 全称 **inline frame**，作用是**在一个网页里嵌入另一个完整的网页**。它的特别之处在于：嵌进来的不是一段 HTML 片段，而是一个**独立的浏览上下文（browsing context）**——有自己的 window、document、历史记录、JS 执行环境，相当于在页面里开了一个"小浏览器"。

每个 iframe 都拥有：

- **独立的 `window` 对象**：iframe 里的 window 不是父页面的 window，是全新的一个；
- **独立的 `document`**：`document.body` 指向 iframe 文档自己的 body；
- **独立的 `history`**：iframe 内部 `pushState` 操作的是 iframe 自己的历史栈；
- **独立的 `location`**：改 iframe 的 `location.href` 只让 iframe 跳转，外层页面不动；
- **独立的 JS 执行环境**：iframe 里的 `Array`、`Promise` 跟外面是两套不同的构造器；
- **独立的事件循环上下文**：定时器、微任务在 iframe 销毁时自动清理。

```js
const iframe = document.querySelector('iframe')
console.log(iframe.contentWindow === window)        // false
console.log(iframe.contentWindow.Array === Array)   // false
```

### 2.3 为什么 iframe 是"原生"沙箱

对比 qiankun：qiankun 用 `Proxy` 拦截子应用对 window 的读写，模拟一个隔离的 window 副本——这是**软沙箱**。问题是 `history`、`location` 等原生对象很难精确拦截，且 `with(proxyWindow){...}` 性能开销不小。

无界直接用一个**同域的 iframe**，iframe 自带浏览器原生的 window，这是浏览器层面的硬隔离：

- 不用模拟 history/location；
- 不用清理副作用——iframe 销毁时所有定时器、监听器自动回收；
- 不用 `with`——子应用代码在 iframe window 上下文里执行，性能接近原生。

为什么是**同域** iframe？因为同源浏览器才允许主应用无障碍访问 `iframe.contentWindow`，把脚本注入进去执行。具体做法是把 iframe 的 `src` 设成主应用同域的一个空白 URL。

### 2.4 阻止 iframe 加载主应用代码

但同域有个副作用——iframe 设了 `src` 后会去请求这个 URL，浏览器会把主应用的 HTML/JS 加载进 iframe，污染了沙箱。无界用 `stopIframeLoading` 解决：

```ts
function stopIframeLoading(iframeWindow: Window) {
  iframeWindow.__WUJIE.iframeReady = new Promise<void>((resolve) => {
    function loop() {
      setTimeout(() => {
        // location ready
        if (iframeWindow.location.href === "about:blank") {
          loop();
        } else {
          iframeWindow.stop();
          initIframeDom(iframeWindow);
          resolve();
        }
      }, 0);
    }
    loop();
  });
}
```

策略是：等到 iframe 的 location 不再是 `about:blank`（说明 src 已经生效、location 正确）的瞬间，立即调 `iframeWindow.stop()` 中断加载，然后 `initIframeDom` 初始化干净的 DOM 环境。

源码注释里有两个值得关注的细节：

> - 如果 iframe 没有实例化完成就进行 stop，location 的 origin 为 about:blank 会导致子应用路由无法运行
> - 如果直接在 iframe 实例化时采用 document.write 擦除，路由器的同步功能将失败

这层时序处理是无界能稳定运行的关键之一。

---

## 三、底层基石：Web Components 与 Shadow DOM

iframe 解决了 JS 隔离，但**如果 DOM 也渲染在 iframe 里，会继承 iframe 全部的视觉短板**：弹窗被框死、滚动条割裂、modal 遮罩盖不出 iframe 边界、首屏白屏。

无界把 DOM 渲染单独安置在主文档的 Shadow DOM 里。这就需要先理解 Web Components。

### 3.1 Web Components 是什么

Web Components 是浏览器原生提供的一套**组件化标准**，让开发者可以创建可复用、带封装、跨框架通用的自定义 HTML 元素。它由三项独立的浏览器 API 组合而成：

1. **Custom Elements**：定义新的 HTML 标签（如 `<my-card>`）；
2. **Shadow DOM**：封装内部结构和样式；
3. **HTML Templates / Slots**：定义可复用的 HTML 模板和插槽。

无界主要用了前两项。

### 3.2 自定义元素 `<wujie-app>`

无界注册了一个名为 `wujie-app` 的自定义元素，作为子应用的 DOM 容器：

```js
class WujieApp extends HTMLElement {
  connectedCallback() {
    // 元素插入主文档时触发
  }
  disconnectedCallback() {
    // 元素从主文档移除时触发
  }
}
customElements.define('wujie-app', WujieApp)
```

主应用里直接当组件用：

```html
<wujie-app name="sub1"></wujie-app>
```

利用 `connectedCallback` / `disconnectedCallback` 这套浏览器原生触发的生命周期，无界把"组件挂载/卸载"和"子应用激活/销毁"自然绑定起来——**这就是为什么无界能像普通组件一样使用，不需要在入口注册路由**。

### 3.3 Shadow DOM 与 shadow root

Shadow DOM 是浏览器原生的一种 DOM **封装机制**，给某个元素挂一棵独立的子树，这棵子树跟外部 DOM 隔离。

注意一个常被混淆的概念：**Shadow DOM 是机制，shadow root 是这个机制下产生的具体对象**。`attachShadow()` 返回的那个根节点就是 shadow root，它的类型是 `ShadowRoot`，继承自 `DocumentFragment`：

```js
const host = document.querySelector('#my-host')        // 宿主元素
const shadow = host.attachShadow({ mode: 'open' })     // shadow root
shadow.innerHTML = `
  <style>p { color: red; }</style>
  <p>I'm inside shadow DOM</p>
`
console.log(host.shadowRoot === shadow)                // true
```

shadow root 提供的隔离边界包括：

- **CSS 完全隔离**：影子树里的样式不外泄，外部全局样式默认不进来——比 qiankun 的 scoped CSS 前缀方案彻底，`:root`、`@keyframes`、字体、伪元素都不会越界；
- **DOM 查询隔离**：外部 `document.querySelector('p')` 找不到影子树内的 p；
- **ID 不冲突**：影子树内部的 id 跟外部命名空间隔离。

但要特别注意：**Shadow DOM 不隔离 JS**——shadow root 内外共享同一个 window、同一套全局环境。所以单靠 Shadow DOM 不够，无界要叠一层 iframe。

### 3.4 整体架构图

把这两个原生能力组合起来，无界的架构变成：

```
┌──────────────── 主应用文档 ────────────────┐
│                                             │
│   ┌──────────────────────────────────┐      │
│   │  <wujie-app>  ← Web Component    │      │
│   │  ┌────────────────────────────┐  │      │
│   │  │  #shadow-root (open)       │  │      │
│   │  │  ├── <style>...</style>    │  │      │
│   │  │  ├── <div id="app">        │  │      │
│   │  │  │     子应用 DOM 全部树     │  │      │
│   │  │  └──                       │  │      │
│   │  └────────────────────────────┘  │      │
│   └──────────────────────────────────┘      │
│                                             │
│   ┌──────────────────────────────────┐      │
│   │  <iframe src="主应用同源空白页">    │      │
│   │   ├── window  ← JS 沙箱           │      │
│   │   ├── history（独立路由栈）         │      │
│   │   ├── location（独立 URL）         │      │
│   │   └── 子应用 instance 运行在这里    │      │
│   └──────────────────────────────────┘      │
│                                             │
│         iframe 不可见、不渲染 DOM            │
│         通过 Proxy 把 document 操作          │
│         转发到 Shadow DOM 上                 │
└─────────────────────────────────────────────┘
```

视觉上看不出嵌套（DOM 在主文档里，弹窗能盖整屏），但隔离一点没少（JS 在 iframe、CSS 在 shadow）——"无界"这个名字就是这么来的。

可以用一个比喻理解：**iframe 是后厨，Shadow DOM 是餐桌**。子应用是厨师，他在自己专属的后厨（iframe）里做菜（执行 JS），后厨的工具（window、history、location、定时器）都是他自己的。但做好的菜（DOM 节点）不留在后厨吃，而是端到大厅里指定的餐桌（shadow root）上摆出来。餐桌在大厅里，所以菜（弹窗、modal）能铺很大；但餐桌之间有隔板（CSS 隔离），不同厨师的菜不会互相串味。

---

## 四、核心技术：Proxy 劫持 iframe 的 document

JS 在 iframe 里跑、DOM 在 shadow root 里渲染——这两个分离的环境怎么连起来？这就是无界的精髓所在。

### 4.1 子应用代码会面对什么问题

子应用代码大概长这样：

```js
const app = document.querySelector('#app')
const div = document.createElement('div')
document.body.appendChild(div)
document.addEventListener('click', handler)
```

它**完全不知道**自己运行在 iframe 里。如果 document 是 iframe 原生的那个 document，会发生什么？

- `document.querySelector('#app')` → 在 iframe 那个空白 document 里找，找不到（#app 在主文档的 shadow root 里）；
- `document.body.appendChild(div)` → 把 div 加到 iframe 的 body，但 iframe 不渲染、用户看不到；
- `document.addEventListener('click', ...)` → 绑到 iframe document 上，iframe 里没有 DOM 永远不触发。

无界的解法是：**用 Proxy 劫持 document，按属性名把每种操作分流到正确的目标**。

### 4.2 Proxy 是什么

ES6 的 `Proxy` 可以包装一个对象，拦截对它的所有操作（读属性、写属性、调方法等），并提供自定义实现：

```js
const proxy = new Proxy(target, {
  get(obj, prop) { /* 拦截读取 */ },
  set(obj, prop, value) { /* 拦截写入 */ }
})
```

外面看起来 proxy 跟 target 长得一样，但所有访问都被中间层"截胡"了。这是无界给子应用提供"假 document"的基础。

### 4.3 proxyDocument 的实现

下面是无界源码中 `proxyDocument` 的核心实现（来自官方文档原理篇）：

```ts
new Proxy(
  {},
  {
    get: function (_fakeDocument, propKey) {
      const document = window.document;
      const shadowRoot = iframe.contentWindow.__WUJIE.shadowRoot;

      // 1. 创建节点：用 iframe 的 document 创建（保持 ownerDocument 自洽）
      if (propKey === "createElement" || propKey === "createTextNode") {
        return new Proxy(document[propKey], {
          apply(createElement, _ctx, args) {
            const element = createElement.apply(iframe.contentDocument, args);
            patchElementEffect(element, iframe.contentWindow);
            return element;
          },
        });
      }

      // 2. URL 类属性：返回 iframe 的代理 location
      if (propKey === "documentURI" || propKey === "URL") {
        return (iframe.contentWindow.__WUJIE.proxyLocation as Location).href;
      }

      // 3. 批量查询接口：转发到 shadowRoot
      if (
        propKey === "getElementsByTagName" ||
        propKey === "getElementsByClassName" ||
        propKey === "getElementsByName"
      ) {
        return new Proxy(shadowRoot.querySelectorAll, {
          apply(querySelectorAll, _ctx, args) {
            let arg = args[0];
            if (propKey === "getElementsByClassName") arg += ".";
            if (propKey === "getElementsByName") arg = `[name="${arg}"]`;
            return querySelectorAll.call(shadowRoot, arg);
          },
        });
      }

      // 4. getElementById：转发到 shadowRoot
      if (propKey === "getElementById") {
        return new Proxy(shadowRoot.querySelector, {
          apply(querySelector, _ctx, args) {
            return querySelector.call(shadowRoot, `#${args[0]}`);
          },
        });
      }

      // 5. querySelector / querySelectorAll：直接绑定到 shadowRoot
      if (propKey === "querySelector" || propKey === "querySelectorAll") {
        return shadowRoot[propKey].bind(shadowRoot);
      }

      // 6. 文档结构类属性：返回 shadowRoot 内对应节点
      if (propKey === "documentElement" || propKey === "scrollingElement")
        return shadowRoot.firstElementChild;
      if (propKey === "forms") return shadowRoot.querySelectorAll("form");
      if (propKey === "images") return shadowRoot.querySelectorAll("img");
      if (propKey === "links") return shadowRoot.querySelectorAll("a");

      // 7. 其他属性：根据预设的属性类型表分流到 shadowRoot 或 document
      const { ownerProperties, shadowProperties, shadowMethods,
              documentProperties, documentMethods } = documentProxyProperties;
      if (ownerProperties.concat(shadowProperties).includes(propKey.toString())) {
        return shadowRoot[propKey];
      }
      if (shadowMethods.includes(propKey.toString())) {
        return getTargetValue(shadowRoot, propKey) ?? getTargetValue(document, propKey);
      }
      if (documentProperties.includes(propKey.toString())) {
        return document[propKey];
      }
      if (documentMethods.includes(propKey.toString())) {
        return getTargetValue(document, propKey);
      }
    },
  }
);
```

逻辑看起来长，本质是**按属性名把操作分流到三个目标**：

| 操作类型                                                                             | 转发目标                                  | 原因                                                                      |
| ------------------------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------- |
| `querySelector` / `querySelectorAll` / `getElementById` / `getElementsByXxx` | shadowRoot                                | 子应用查的是它自己的 DOM，DOM 在 shadow 里                                |
| `body` / `head` / `documentElement` / `forms` / `images`                   | shadowRoot 内对应节点                     | 让子应用以为自己有正常文档结构                                            |
| `createElement` / `createTextNode`                                               | iframe 的 document                        | 节点 ownerDocument 必须是某个真实 Document，shadowRoot 没有 createElement |
| `documentURI` / `URL`                                                            | proxyLocation                             | 这些跟 URL 相关                                                           |
| 其他属性方法                                                                         | shadowRoot 或 主 document（按预设属性表） | 各属性的语义决定了去哪里                                                  |

> **为什么 createElement 要用 iframe 的 document？** shadowRoot（继承自 DocumentFragment）没有 createElement 方法，节点必须由某个 Document 创建。让节点 ownerDocument 指向 iframe document 后，子应用代码里 `el instanceof HTMLDivElement`（这里的 HTMLDivElement 是 iframe 里的）才能正确判断——这是个隐蔽但关键的细节，否则一些第三方库的 instanceof 检查会全部失败。

### 4.4 怎么让子应用代码用上代理对象

代理建好了，怎么让子应用代码里的 `document`、`window`、`location` 标识符指向它？无界用一段 IIFE（立即执行函数）包装把子应用脚本注入 iframe：

```ts
const script = `(function(window, self, global, location) {
    ${code}\n
  }).bind(window.__WUJIE.proxy)(
    window.__WUJIE.proxy,
    window.__WUJIE.proxy,
    window.__WUJIE.proxy,
    window.__WUJIE.proxy.location,
  );`;
```

通过参数遮蔽（shadowing），子应用代码里写的 `window`、`self`、`global` 都指向 `proxyWindow`，`location` 指向 `proxyLocation`。

document 则不用闭包包装——无界直接修改了 iframe 内 `Document.prototype` 上的相关方法，所以子应用拿到的 document 行为已经是代理后的行为。

> 官方源码注释提醒：当 script 的 type 为 module（即 ESM）时会去掉这层闭包包装，子应用需要通过 `window.$wujie.location` 来访问代理后的 location。这是无界支持 vite 的关键点。

### 4.5 location 代理

iframe 自带原生 location，但子应用看到的 host 应该是子应用自己的 host（不是主应用的同源空白页 host）。所以无界还代理了 location：

```ts
new Proxy(
  {},
  {
    get: function (fakeLocation, propKey) {
      const location = target.location;
      // host / hostname / protocol / port 返回子应用真实的 URL 信息
      if (propKey === "host" || propKey === "hostname"
       || propKey === "protocol" || propKey === "port") {
        return urlElement[propKey];
      }
      // href 把主应用 host 替换回子应用 host
      if (propKey === "href") {
        return target.location[propKey].replace(mainPublicPath, appPublicPath);
      }
      // reload 警告并禁用
      if (propKey === "reload") {
        warn("子应用调用reload无法生效");
        return () => null;
      }
      return getTargetValue(location, propKey);
    },
    set: function (location, propKey, value, receiver) {
      // 设置 href 当作子应用跳转处理
      if (propKey === "href") { /* ... */ }
      return Reflect.set(location, propKey, value, receiver);
    },
  }
);
```

子应用读 `location.host` 拿到的是子应用自己的 host，但 history/pathname/hash 这些动态状态用的是 iframe 的真实 location——一种"路径用真实的、域名信息伪装成子应用"的混合策略。

### 4.6 副作用补丁

除了代理对象，无界还做了一系列副作用打补丁，保证子应用行为和直接运行在浏览器里时一致。来自官方文档的初始化清单：

```js
// location 劫持后的数据修改回来，防止跨域错误；同步路由到主应用
patchIframeHistory(iframeWindow, appPublicPath, mainPublicPath);
// 对 window.addEventListener 进行劫持（resize 等必须监听主应用的）
patchIframeEvents(iframeWindow);
// 注入私有变量
patchIframeVariable(iframeWindow, appPublicPath);
// 将有 DOM 副作用的统一在此修改（mutationObserver 必须调用主应用的）
patchIframeDomEffect(iframeWindow);
// 子应用前进后退，同步路由到主应用
syncIframeUrlToWindow(iframeWindow);
```

shadowRoot 这边也要打补丁，主要是覆盖 `appendChild` 和 `insertBefore`：

```js
shadowRoot.head.appendChild = getOverwrittenAppendChildOrInsertBefore({
  rawDOMAppendOrInsertBefore: rawHeadAppendChild
}) as typeof rawHeadAppendChild
shadowRoot.body.appendChild = getOverwrittenAppendChildOrInsertBefore({
  rawDOMAppendOrInsertBefore: rawBodyAppendChild
}) as typeof rawBodyAppendChild
// insertBefore 同理
```

`getOverwrittenAppendChildOrInsertBefore` 处理四种类型的标签：

- **link/style 标签**：收集到 `stylesheetElements` 用于子应用重新激活时恢复样式；
- **script 标签**：动态插入的 script 必须从 shadowRoot 转移到 iframe 里执行（shadow 里的 script 不会执行）；
- **iframe 标签**：修复其 contentWindow 指向；
- **其他**：正常插入。

这层处理保证子应用动态加载资源、热更新、按需加载这些场景都开箱即用。

---

## 五、路由系统：天然解耦 + 可选同步

iframe 自带独立的 history 和 location，所以子应用的路由器（vue-router、react-router）**完全在 iframe 里自治**。这是 qiankun 等方案要花大力气模拟的能力，无界白送。

### 5.1 浏览器前进后退天然支持

无界利用了一个浏览器特性：**iframe 的 history 和主应用的 history 处于同一个 [top-level browsing context](https://html.spec.whatwg.org/multipage/browsers.html#top-level-browsing-context)**。

> 在 iframe 内部进行 `history.pushState`，浏览器会自动地在 [joint session history](https://html.spec.whatwg.org/multipage/history.html#joint-session-history) 中添加 iframe 的 [session-history](https://html.spec.whatwg.org/multipage/history.html#session-history)，浏览器的前进、后退在不做任何处理的情况就可以直接作用于子应用。

也就是说：用户按浏览器后退按钮，浏览器会自动找到正确的 history 栈（可能是主应用的也可能是子应用的）来响应——这是 iframe 嵌入主页面时自带的浏览器行为。

### 5.2 URL 同步：可选

但产品上常常需要把子应用当前 URL 反映到浏览器地址栏（刷新可恢复、链接可分享）。无界劫持 iframe 的 `pushState` 和 `replaceState`，把子应用的 path 同步到主应用 URL 的 query 参数上。当浏览器刷新、初始化 iframe 时，反向读回子应用 URL，用 iframe 的 `replaceState` 同步回去。

效果是：地址栏总是反映"主应用路径 + 子应用路径"，刷新页面能恢复到子应用的当前路由。

---

## 六、三种运行模式：保活 / 单例 / 重建

无界对子应用生命周期的管理非常灵活。子应用是否设置 `alive`、是否定义 `__WUJIE_MOUNT` / `__WUJIE_UNMOUNT`，会决定进入完全不同的处理流程。

来自官方文档运行图的描述：**子应用的 shadowRoot、iframe 和承载子应用的组件是解耦的，iframe 中运行着子应用的实例 instance**——这层解耦让三种模式成为可能。

### 6.1 保活模式（alive: true）

最强保留——iframe、shadowRoot、子应用实例 instance **全部保留**：

- 切走时：组件被销毁，但 shadowRoot 从容器上摘下来留在内存里，iframe 也保留；
- 切回来时：把 shadowRoot 重新挂到组件容器上即可，相当于一次"插拔"。

效果接近 Vue 的 `<keep-alive>`，但是跨应用维度的——子应用的状态、路由、滚动位置、未提交的表单全部保留。**结合 `preloadApp({ exec: true })` 预执行使用，效果接近 SSR 的打开体验**——切换瞬时完成、零白屏。

注意保活下子应用的 instance 不会销毁，所以子应用切走后仍然能响应 EventBus 事件——这是非保活模式做不到的。

### 6.2 单例模式（alive: false + 改造生命周期）

子应用通过定义 `window.__WUJIE_MOUNT` 和 `window.__WUJIE_UNMOUNT` 改造生命周期：

```js
let app
function renderApp() {
  app = new Vue({ router, store, render: h => h(App) })
  app.$mount('#app')
}
function destroyApp() {
  app.$destroy()
}
if (window.__POWERED_BY_WUJIE__) {
  window.__WUJIE_MOUNT = renderApp
  window.__WUJIE_UNMOUNT = destroyApp
} else {
  // 子应用独立运行
  renderApp()
}
```

切走时调 `__WUJIE_UNMOUNT` **销毁子应用实例**并清空 shadowRoot 内部所有元素，但 **iframe 和 shadowRoot 容器都保留**。切回来调 `__WUJIE_MOUNT` 创建新实例，无界把子应用的 HTML 重新填充到 shadowRoot 里。

适合主应用菜单上有多个入口指向同一子应用不同页面的场景：通过 `name` 相同共享一个 wujie 实例（也共享 iframe 沙箱），通过不同的 `url` 切换页面。切换的过程相当于：销毁当前应用实例 → 同步新路由 → 创建新应用实例。js 沙箱常驻，资源不重新下载。

### 6.3 重建模式（alive: false + 不改造生命周期）

每次切换销毁所有：iframe、shadowRoot、Wujie 实例都重新创建。等效于把 iframe 当普通标签用，但有预加载加持。

### 6.4 三种模式对比

| 模式 | iframe   | shadowRoot | 子应用实例 | 状态保留 | 白屏     | 适用场景                    |
| ---- | -------- | ---------- | ---------- | -------- | -------- | --------------------------- |
| 保活 | 保留     | 保留挂载   | 保留       | 全部     | 几乎为零 | 单 tab 入口、需要保留状态   |
| 单例 | 保留     | 保留容器   | 重建       | 不保留   | 短       | 多 tab 入口、共享一个子应用 |
| 重建 | 销毁重建 | 销毁重建   | 重建       | 不保留   | 长       | 简单场景、一次性使用        |

---

## 七、应用通信：三种方式各取所需

因为 iframe 和主应用同源，**跨上下文调用就是普通的 JS 引用**——没有 postMessage 的序列化开销，跟操作普通对象一样高效。无界提供三种通信通道。

### 7.1 props 注入

主应用主动向子应用传数据/方法：

```html
<WujieVue name="xxx" url="xxx" :props="{ data: xxx, methods: xxx }"></WujieVue>
```

子应用通过 `$wujie.props` 拿到：

```js
const props = window.$wujie?.props // { data: xxx, methods: xxx }
```

适合父子单向数据流。

### 7.2 window.parent 直通

iframe 同源，子应用直接访问 `window.parent`：

```js
// 子应用调用主应用的全局数据
console.log(window.parent.someMainAppGlobal)

// 主应用调用子应用的全局数据
window.document.querySelector("iframe[name=子应用id]").contentWindow.xxx
```

简单粗暴，类似传统 iframe 通信，但因为同源没有 postMessage 的序列化开销。

### 7.3 EventBus 去中心化

无界注入的事件总线，主子应用、子子应用都能用：

```js
// 主应用
import WujieVue from 'wujie-vue3'
const { bus } = WujieVue
bus.$on('some-event', payload => { /* ... */ })
bus.$emit('some-event', payload)

// 子应用
window.$wujie?.bus.$on('some-event', payload => { /* ... */ })
window.$wujie?.bus.$emit('some-event', payload)
```

适合多个子应用之间或松耦合的事件型协作。

---

## 八、和 qiankun 的对比

把无界和当前最流行的 qiankun 横向比一下：

| 维度                  | qiankun（基于 single-spa）                | wujie                          |
| --------------------- | ----------------------------------------- | ------------------------------ |
| JS 沙箱               | Proxy 模拟 window（三套渐进方案）         | iframe 原生 window             |
| CSS 沙箱              | Scoped CSS / Shadow DOM                   | Shadow DOM                     |
| history/location 隔离 | 模拟，存在边界问题                        | 浏览器原生                     |
| 子应用接入成本        | 改 webpack、暴露 lifecycle、改 publicPath | 几乎零改造                     |
| 启动方式              | registerMicroApps + 路由激活              | 组件式（`<WujieVue>`）直接用 |
| 多应用同时激活        | 不支持（基于路由匹配）                    | 原生支持                       |
| 保活能力              | 不支持                                    | 原生支持 alive 模式            |
| vite 支持             | 困难（ESM 没全局入口）                    | 良好（iframe 直接执行 ESM）    |
| 副作用清理            | 手动管理                                  | iframe 销毁自动回收            |
| JS 执行性能           | `with(proxyWindow){...}` 有损耗         | 接近原生                       |
| 生态成熟度            | 高                                        | 中等但增长快                   |

简单说：qiankun 是"在自家客厅给客人圈一块地，靠规矩约束他不要乱动家里东西"；无界是"直接给客人一间独立公寓（iframe），他在里面怎么折腾都行，走的时候房子拆了就完事"。

---

## 九、源码阅读建议

如果想深入研究无界，推荐按这个顺序读 [Tencent/wujie](https://github.com/Tencent/wujie) 仓库的核心代码：

1. **`packages/wujie-core/src/sandbox.ts`**：`Wujie` 类的核心定义，看 iframe、shadowRoot、proxy 三件套的初始化时机；
2. **`packages/wujie-core/src/iframe.ts`**：`stopIframeLoading`、`initIframeDom`、`patchIframeHistory` 等，看 iframe 如何被初始化和打补丁；
3. **`packages/wujie-core/src/proxy.ts`**：`proxyGenerator`，看 proxyWindow / proxyDocument / proxyLocation 三件套怎么生成；
4. **`packages/wujie-core/src/shadow.ts`**：Shadow DOM 容器的构造和资源注入；
5. **`packages/wujie-core/src/entry.ts`** / **`template.ts`**：HTML 模板解析、css/js 资源处理流程；
6. **`packages/wujie-core/src/effect.ts`**：DOM 副作用打补丁，包括 `appendChild`、`addEventListener` 等的拦截；
7. **`packages/wujie-vue3/`** / **`wujie-react/`**：框架封装层，看怎么把 core 包成 Vue/React 组件。

无界源码总量不大，把 core 包看完大约就理解了整个工程的全貌。

---

## 十、总结：用原生能力代替自行模拟

无界的核心创新可以归结为一句话——**用 iframe 拿原生 JS 沙箱，用 Shadow DOM 拿轻量 CSS/DOM 隔离，用 Proxy 把两者无缝连接起来**。

它的设计哲学是"**用浏览器原生能力代替自行模拟**"：

- 别用 Proxy 模拟 window，浏览器有现成的 → iframe；
- 别用 CSS 前缀模拟作用域，浏览器有现成的 → Shadow DOM；
- 别自己写路由隔离，浏览器有现成的 → iframe 的 history/location；
- 别管理副作用清理，浏览器有现成的 → iframe 销毁回收一切。

剩下需要自己做的，只是把这些原生能力**缝合**起来——让子应用代码无感知地跨过 iframe 和 shadowRoot 的边界（Proxy 劫持 document）、让弹窗能跨出 iframe 视觉边界（DOM 渲染在 shadow 里）、让路由能选择性同步到主应用（劫持 history.pushState）。

无界的工程价值就在这层缝合上：核心代码量不大，但每一处都解决了真实痛点。

如果你的微前端场景里碰到了样式污染、保活困难、vite 子应用接不进、白屏严重、多应用同时激活等问题，无界值得认真考虑一下。

---

## 参考资料

- [无界官方文档 - 微前端是什么](https://wujie-micro.github.io/doc/guide/)
- [无界官方文档 - 原理篇](https://wujie-micro.github.io/doc/guide/information.html)
- [无界官方文档 - 运行模式](https://wujie-micro.github.io/doc/guide/mode.html)
- [无界官方文档 - 通信系统](https://wujie-micro.github.io/doc/guide/communication.html)
- [Tencent/wujie GitHub 仓库](https://github.com/Tencent/wujie)
- [HTML Living Standard - top-level browsing context](https://html.spec.whatwg.org/multipage/browsers.html#top-level-browsing-context)
- [MDN - Web Components](https://developer.mozilla.org/en-US/docs/Web/Web_Components)
