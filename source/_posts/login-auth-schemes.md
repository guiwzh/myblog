---
title: Token 该放在哪里？拆解大厂六种主流登录方案
date: 2026-10-20 10:00:00
categories:
  - 前端
tags:
  - 前端
  - Web安全
  - 登录鉴权
  - Cookie
  - OAuth
  - SSO
description: Token 该放 localStorage 还是 Cookie？从常见的双 Token 方案出发，图解大厂最主流的六种登录方案：Session + HttpOnly Cookie、BFF、SSO 单点登录、OAuth 第三方登录、扫码登录与手机号登录，讲清它们怎么工作、各自的代价和适用场景。
cover: https://picsum.photos/seed/login-auth-schemes/800/450
---

> 登录成功之后，那张证明「你是你」的凭证该放在哪里？localStorage、Cookie，还是干脆不交给浏览器？这个看似简单的问题，恰恰是大厂登录方案分歧最大的地方。本文从很多 SPA 都在用的双 Token 方案出发，图解六种最主流的登录方案：它们怎么工作、代价是什么、适合什么场景。读完之后，你手里会有一张清晰的登录方案地图。

---

## 缘起

我在一个 C 端商城项目里做过一套双 Token 无感刷新：并发请求同时 401 时只刷新一次，多个标签页之间互斥刷新，细节抠得挺细。可一旦被问到「大厂是怎么做登录的」「为什么不用 HttpOnly Cookie」，我只能讲清自己做了什么，讲不清别人为什么那样做。

于是我系统地调研了一圈，这篇文章就是调研的整理。它不求面面俱到，只讲最主流的六种方案，但每一种都尽量讲到「为什么」。

---

## 先画一张地图：登录要回答三个问题

刚开始调研时，我被一堆名词绕晕了：Session、Token、OAuth、SSO、扫码……后来才发现，它们根本不是同一类东西，而是在回答登录过程中的三个不同问题：

1. **入口层：你是谁？** 用户通过什么方式证明自己：短信验证码、微信授权，还是手机扫码。
2. **登录态层：凭什么一直认得你？** 验明身份后，系统发给浏览器一张「通行证」，之后的每个请求都靠它识别用户。通行证长什么样、放在哪，是这一层要回答的问题。
3. **跨系统层：换个网站还认不认你？** 一家公司有多个系统、多个域名时，怎么做到登录一次、处处通行。

![六种方案分属三层：入口层、登录态层、跨系统层](fig-01-overview.svg)

同一层里的方案互相替代，不同层之间可以自由组合。比如「微信扫码登录 + Cookie 会话 + SSO」，就是一个完全合理的组合。

本文按「登录态 → 跨系统 → 入口」的顺序展开，因为分歧最大、也最值得讲透的，是中间的登录态层。

---

## 起点：大多数 SPA 的双 Token 方案

在看大厂方案之前，先看一个很多前端都写过的方案。后面讲登录态时，都会拿它来对比。

- 登录成功后，后端返回两个 token：**access_token** 寿命短（比如半小时），每个请求都要带上；**refresh_token** 寿命长（比如一周），只用来换新的 access_token。
- 前端把它们存进 localStorage 或 sessionStorage，发请求时由 JS 读出来，塞进 `Authorization` 请求头。
- access_token 过期、接口返回 401 时，前端悄悄用 refresh_token 换一个新的，再把原请求重放一遍，用户毫无察觉。这就是常说的「无感刷新」。

```ts
// 请求拦截器：由 JS 读出 token，手动塞进请求头
axios.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
```

注意这里的 `Bearer`，它的意思是「持有者」：**谁拿着这个 token，谁就被当成你**。后面所有的安全取舍，都从这一点开始。

真实项目里，这套方案还有不少工程细节，比如并发请求同时 401 时怎么只刷新一次、多个标签页之间怎么协调刷新。这些值得单独写一篇，这里先不展开。

---

## 两个绕不开的攻击：XSS 与 CSRF

登录态放在哪，本质上是在两种攻击之间做取舍。

- **XSS（跨站脚本攻击）**：攻击者设法让一段恶意脚本在你的页面里运行。这段脚本和你自己的代码权限完全一样，**JS 能读到的，它都能读到**，包括 localStorage 里的 token。
- **CSRF（跨站请求伪造）**：用户登录着你的网站，又打开了一个恶意网站，恶意网站悄悄向你的网站发请求。**浏览器会自动带上你网站的 Cookie**，服务端分不清这个请求是不是用户本人发的。

两种凭证载体，正好各怕一种：

|  | JS 存储 + `Authorization` 头 | HttpOnly Cookie |
| --- | --- | --- |
| 遇到 XSS | token 会被读走，落到攻击者手里长期使用 | JS 读不到凭证，攻击者只能趁页面开着时借它发请求 |
| 遇到 CSRF | 天然免疫：浏览器不会给跨站请求自动加请求头 | 需要防护：`SameSite`、自定义请求头等 |

有两点值得多想一步。第一，XSS 一旦发生，两种载体都挡不住「借你的页面发请求」，真正的区别在于凭证能不能被**带走**。第二，CSRF 有 `SameSite` 这类成熟的机制性防护，XSS 却很难保证百分之百杜绝。这也是很多大厂在 Web 端偏爱 Cookie 的重要原因。

---

## 方案 A：服务端 Session + HttpOnly Cookie

国内大厂 C 端网页最常见的做法。公开的逆向分析显示，淘宝、京东的网页登录态都由 Cookie 承载。核心思想一句话：**凭证不进 JS**。

> 打个比方：Session ID 就像存包处的号码牌。牌子上没有任何信息，东西都锁在柜台里，柜台想让哪张牌作废，当场就能作废。`HttpOnly` 则保证这张牌由浏览器直接交给柜台，页面上的 JS（包括恶意脚本）摸不着它。

### 工作流程

1. 用户登录成功，服务端生成一个随机的会话 ID，把会话数据存进 Redis 这类集中式存储。
2. 服务端通过 `Set-Cookie` 响应头，把会话 ID 下发给浏览器。
3. 之后每个请求，浏览器都会自动带上这个 Cookie；服务端用它查到会话，就知道是谁，并顺手延长有效期。
4. 用户退出、改密码，或者风控发现异常时，服务端删掉这条会话，登录态立刻失效。

```http
Set-Cookie: __Host-sid=7f3a9c...; Path=/; HttpOnly; Secure; SameSite=Lax
```

这一行里，每个属性都在堵一个口子：

- `HttpOnly`：JS 读不到，XSS 偷不走；
- `Secure`：只在 HTTPS 下发送，防止明文传输被窃听；
- `SameSite=Lax`：从别的网站发起的子请求和 POST 不带这个 Cookie，挡掉大部分 CSRF；纯 SPA 可以进一步收紧到 `Strict`；
- `__Host-` 前缀：要求必须带 `Secure`、`Path=/`，并且不能设 `Domain`，防止被子域名覆盖。

对比双 Token 的请求拦截器，前端在这里什么都不用做：

```ts
// 同源请求会自动带上 Cookie（跨域请求才需要 withCredentials）
const { data } = await axios.get('/api/orders');
```

### 为什么大厂偏爱它

- **XSS 带不走登录态。** 恶意脚本顶多趁页面开着时借浏览器发请求，拿不到凭证。
- **服务端说了算。** 踢人下线、管理登录设备、限制同时在线，删一条会话记录就完事。token 方案要做到这些，往往得额外维护黑名单，或者等 access_token 自然过期。
- **多标签页天然一致。** 所有标签页共享同一份 Cookie，前端不用写任何刷新和同步逻辑。

### 代价

- **必须防 CSRF。** Cookie 会被浏览器自动带上，`SameSite` 之外，通常还要加自定义请求头或 CSRF token。
- **服务端有状态。** 需要一套高可用的集中式会话存储，用户量越大，这部分成本越高。
- **App、小程序不太适用。** 它们没有浏览器那套自动携带、`HttpOnly` 的 Cookie 机制，账号中心通常会为它们另外签发 token。

### 和双 Token 比

它是双 Token 的直接替代，而且不一定需要 BFF：只要前端和 API 同站（同一个可注册域名），API 服务直接下发 HttpOnly Cookie 就行。2026 年 8 月发布的 RFC 10017 第 7.1 节，专门讨论了这种不需要 OAuth 的同域会话。

另外，Chrome 今年正式推出的 DBSC（Device Bound Session Credentials）能把会话 Cookie 绑定到设备的 TPM 芯片上，被木马偷走的 Cookie 在别的机器上用不了。这项能力**只对 Cookie 会话生效**。

---

## 方案 B：BFF 代管 Token

如果说方案 A 是「不要 token」，方案 B 就是「token 照样有，但不交给浏览器」。浏览器只拿一个会话 Cookie，所有 token 都由服务端的 BFF（Backend For Frontend，专门服务前端的后端层）保管和刷新。RFC 10017 把它列为浏览器端**最安全**的架构，并强烈推荐用于业务应用和处理个人数据的应用。

> 打个比方：BFF 就像银行柜员。你手里只有一张排队号码牌，真正的存折和印鉴锁在柜台后面，由柜员替你去办事。

### 工作流程

1. 用户点登录，浏览器跳到 BFF，由 BFF 向授权服务器发起「授权码 + PKCE」登录。授权码流程在方案 D 里细讲；PKCE 是它的加固扩展，防止授权码被截获后冒用。
2. BFF 拿到 access_token 和 refresh_token，存在服务端，给浏览器种一个 HttpOnly 会话 Cookie。
3. 页面的所有 API 请求都先发给 BFF，BFF 凭 Cookie 找到对应的 token，附上后转发给后端服务。
4. access_token 过期时，BFF 在服务端自己刷新，浏览器全程无感。

### 优点与代价

优点很直接：浏览器里**没有任何 token**；刷新、并发去重、请求重放都挪到了服务端，前端的登录代码几乎清零；BFF 还是统一的出入口，对接第三方授权服务器、做限流和异常检测都很方便。

代价也同样直接：多了一个要运维的代理层，所有 API 流量都要经过它；它依然依赖 Cookie，照样要防 CSRF；转发必须按白名单来，否则可能被诱导把 token 发到任意地址。

### 轻量版：refresh_token 进 HttpOnly Cookie

嫌完整的 BFF 太重？RFC 10017 还描述了一个折中形态，叫 **Token-Mediating Backend**：后端只把 refresh_token 放进 HttpOnly Cookie（或服务端会话）保管，把短命的 access_token 交给前端，前端照旧直连 API。

它的安全性介于两者之间：XSS 还能拿到当前的 access_token，但**拿不到 refresh_token，也换不出新的**。写法上它和双 Token 最接近，区别只在 refresh_token 改由 HttpOnly Cookie 保管。

### 四种做法放在一起看

把双 Token、轻量版、方案 A、方案 B 放进同一张图，差别一目了然：

![长期凭证离 JS 越远，XSS 能带走的就越少](fig-02-credential-location.svg)

从左往右，JS 能读到的凭证越来越少。到了方案 A 和方案 B，这一格已经空了：就算发生 XSS，也没有凭证可以带走。

---

## 方案 C：SSO 统一认证中心

前面讲的都是单个网站的登录态。当一家公司有很多系统、很多域名时，就需要 SSO（Single Sign-On，单点登录）：一处登录，处处通行。常见实现有三种：同父域共享 Cookie、CAS 票据跳转、OIDC 身份中心。最经典的是 CAS，用它来看清流程。

> 打个比方：SSO 像大园区的总台。你只在总台登记一次；之后每进一栋楼，保安都请你先去总台领一张一次性小票。总台认得你，直接给票；保安再打电话向总台核对这张票，确认无误后，发给你这栋楼的通行卡。

### 工作流程（以 CAS 为例）

1. 用户访问系统 A，系统 A 发现没登录，把浏览器重定向到认证中心，并带上自己的地址。
2. 用户在认证中心登录成功。认证中心在**自己的域名**下种一个 Cookie（TGC），再带上一次性票据 ST，把浏览器重定向回系统 A。
3. 系统 A 的后端拿着 ST 回认证中心校验，通过后建立自己的局部会话。
4. 用户再访问系统 B 时，同样被重定向到认证中心。这一次浏览器自动带上了 TGC，认证中心知道用户已经登录，直接签发一张新的 ST，用户全程不用再输密码。

![第二个系统不用再输密码：认证中心凭 TGC 直接签发新 ST](fig-03-cas-sso.svg)

关键在于：**ST 只能用一次，并且必须由系统的后端回源校验**。系统 A、B 既接触不到密码，也接触不到认证中心的 TGT（TGC 背后对应的服务端凭证）。

### 三种实现怎么选

| 实现 | 适用场景 | 注意点 |
| --- | --- | --- |
| 同父域共享 Cookie | 所有系统都在同一个父域名下 | 任一子域被接管会波及全站 |
| CAS 票据跳转 | 跨主域名、企业内网 | 跨系统时多一次跳转 |
| OIDC 身份中心 | 多业务线、多终端共用一套账号 | 需要搭建或采购身份服务 |

### 一个值得警惕的例子：淘宝与天猫

taobao.com 和 tmall.com 是两个不同的主域名，没法共享 Cookie。早期的做法是：登录后用 script、img 这类跨域请求，挨个调用兄弟域名的「写 Cookie」接口，让每个域名都把登录态写进自己名下。

这招依赖**第三方 Cookie**，而 Safari 和 Firefox 默认拦截第三方 Cookie。早在 2019 年就有人反馈，用 Safari 逛淘宝、天猫会频繁要求重新登录，关掉「阻止跨站跟踪」才好转。所以今天更稳妥的做法，是像 CAS 那样整页跳转换票。

由此得出一条经验：iOS 上的浏览器基本都基于 WebKit，**凡是跨域登录，都要按「第三方 Cookie 不可用」来设计**。

---

## 方案 D：OAuth 2.0 第三方授权登录

从这里开始是入口层：用户用什么方式证明「我是我」。

微信登录、支付宝登录、Apple 登录，本质都是 OAuth 2.0 的**授权码模式**。你的网站不认识这个用户，但认识微信；微信替你确认「这就是那个人」，再把结果告诉你。

> 打个比方：微信给你的不是身份证，而是一张一次性的取件码。取件码被人看到也没关系，因为只有带上你自己的密钥去柜台，才能凭它取到真正的包裹。

### 工作流程（以微信网站扫码登录为例）

1. 用户点「微信登录」，后端生成一个随机的 `state` 存进会话，再把浏览器重定向到微信授权页（`scope=snsapi_login`），带上回调地址和这个 `state`。
2. 用户用手机微信扫码并确认后，微信把浏览器重定向回回调地址，带上一次性的 `code` 和原样返回的 `state`。
3. 后端先比对 `state` 防 CSRF，再用 `code` 加 AppSecret，**从服务端直接**向微信换取 access_token 和 openid。
4. 后端按 openid（或 UnionID）找到或创建本地账号，签发**自己的**登录态，也就是前面方案 A、B 或双 Token 里的那张通行证。

![token 从不经过浏览器：code 在服务端换成身份](fig-04-oauth-code.svg)

### 为什么要多绕一步 code？

直接把 token 放进回调地址，不是更简单吗？早年 OAuth 的「隐式模式」就是这么做的，后来被标准明确弃用，原因就在于 token 会出现在地址栏里，浏览器历史、页面上的第三方脚本都可能拿到它。

授权码模式把这一步拆成了两段：

- **前端通道**（经过浏览器跳转）只传 `code`：它一次性、短时效，单独拿到也换不出 token；
- **后端通道**（服务端直连微信）才真正换 token，并且要带上只存在服务端的 AppSecret。

于是，**真正的凭证从头到尾不经过浏览器**。图里的蓝色箭头，就是这条后端通道。

### 小程序版本

几乎一模一样：`wx.login` 拿到一次性的 code，后端调 `code2Session` 换回 openid 和 session_key，再生成自己的 token 返回给小程序。session_key 是对用户数据做加解密和签名校验的密钥，绝不能下发到前端。支付宝、抖音小程序也是同一个模式。

### 几个容易踩的坑

- **code 换 token 必须在服务端做**，AppSecret 绝不能出现在前端代码里。
- **用 UnionID 打通身份**：同一开放平台下的网站、App、小程序，靠 UnionID 识别是同一个人。
- **小程序获取手机号要花钱**：手机号快速验证组件自 2023 年 8 月起按次收费，每次 0.03 元。
- **iOS 审核有硬性要求**：App 只要用微信等第三方账号来登录用户的主账号，App Store 审核指南 4.8 就要求同时提供一个注重隐私的等效登录选项，Sign in with Apple 就符合要求。

---

## 方案 E：扫码登录

PC 端的主流登录方式，淘宝、京东、微信网页版都在用：手机 App 已经登录，扫一下电脑上的二维码，电脑就登录了。它的本质是**让一台已登录的设备，为另一台设备作保**，前提是你得有自家 App。

### 工作流程

1. 电脑页面向服务端申请二维码。服务端生成一个唯一 ID，状态记为「待扫描」，存进 Redis，并设一个很短的过期时间。
2. 电脑页面开始轮询这个 ID 的状态（也可以用长轮询或 WebSocket）。
3. 手机 App 扫码后，带着**自己的登录态**把状态改成「已扫描」，电脑随即显示用户头像。
4. 用户在手机上点「确认登录」，状态变为「已确认」。服务端给电脑签发一张一次性票据，电脑再用它换取正式的登录态。

![扫码只改状态，点确认才放行：手机为电脑作保](fig-05-qr-login.svg)

电脑端的轮询，其实就是一个小状态机：

```ts
type QrStatus = 'WAITING' | 'SCANNED' | 'CONFIRMED' | 'CANCELED' | 'EXPIRED';

async function pollQrLogin(qrId: string, signal: AbortSignal) {
  while (!signal.aborted) {
    const { data } = await axios.get(`/api/qr/${qrId}`, { signal });
    switch (data.status as QrStatus) {
      case 'SCANNED':
        showScannedUser(data.avatar); // 已扫描，等手机确认
        break;
      case 'CONFIRMED':
        return exchangeTicket(data.ticket); // 用一次性票据换登录态，轮询接口不直接返回长期凭证
      case 'CANCELED':
      case 'EXPIRED':
        return renewQrCode(); // 换一张新码
    }
    await sleep(document.hidden ? 5000 : 1500); // 页面不可见时降低轮询频率
  }
}
```

### 安全要点

- **必须二次确认。** 扫码只表示「我看到了这个码」，确认才表示「我同意在这台电脑上登录」。少了这一步，用户扫了别人发来的码，就等于把自己的账号登到了对方电脑上。
- **二维码短时效、一次性。** 手机确认页还要展示登录设备和地点，给用户发现异常的机会。

---

## 方案 F：手机号快捷登录

国内电商的默认入口：**短信验证码兜底，有移动数据时用运营商一键登录加速**。

### 短信验证码

1. 用户输入手机号，前端先过滑块或无感人机验证，挡住脚本刷短信。
2. 服务端按手机号、IP、设备三个维度限频，再发送验证码。
3. 用户回填验证码，服务端校验通过后签发登录态。验证码要短时效，并限制尝试次数。

前端有一个几乎零成本的体验优化：

```html
<input type="text" inputmode="numeric" autocomplete="one-time-code" />
```

加上 `autocomplete="one-time-code"`，iOS 可以从短信里自动填充验证码；Android 上的 Chrome 则可以用 WebOTP API 自动读取。另外，登录和注册接口**不要暴露「这个手机号是否已注册」**，否则会被拿来批量枚举。

### 运营商一键登录

运营商通过移动数据网关，直接识别出这张 SIM 卡的手机号，用户点一下就能登录，阿里云、极验、个推等都提供三网 SDK。它在 App 里体验最好；到了 H5 就要打折扣：JS 没法强制走移动网络，连着别人的热点时甚至可能取到别人的号，所以必须让用户补输手机号中间 4 位，开着 WiFi 时也用不了。因此 H5 只把它当作加速入口，**失败一律回到短信**。

---

## 怎么选

六种方案分属三层，选型也要分层来看：

| 方案 | 所在层 | 代表实例或依据 | 适用场景 |
| --- | --- | --- | --- |
| A Session + HttpOnly Cookie | 登录态 | 淘宝、京东网页端 | 前端与 API 同站的 Web 应用 |
| B BFF 代管 Token | 登录态 | RFC 10017 推荐的最安全架构 | 处理个人数据的应用；嫌代理层太重可选轻量版 |
| C SSO 统一认证中心 | 跨系统 | 淘宝与天猫、企业内网 | 多域名、多业务线共用一套账号 |
| D OAuth 2.0 第三方授权 | 入口 | 微信、支付宝、Apple 登录 | 拉新，以及各家小程序 |
| E 扫码登录 | 入口 | 淘宝、京东、微信网页版 | 已有自家 App 的 PC 端 |
| F 手机号快捷登录 | 入口 | 国内电商普遍采用 | 国内 C 端，几乎必备 |

落到一个典型的国内电商网站上，可能会这样组合：入口层用手机号兜底，用微信和支付宝拉新，PC 端再加上扫码；登录态层在 Web 端用 Cookie 会话（方案 A 或 B），App 和小程序另发 token；业务线多了，再用 SSO 把各个域名串起来。

回头看，六种方案其实只在回答三个问题：你是谁、凭什么一直认得你、换个网站还认不认你。分歧最大的是第二个问题，而它的分水岭只有一个：**凭证能不能被 JS 读到**。

---

## 附：五个高频问题

读完可以拿这几个问题自测一下。

**1. token 放 localStorage 有什么问题？**

localStorage 本身没问题，怕的是 XSS：JS 能读到的凭证，恶意脚本也能读到并带走。HttpOnly Cookie 让 JS 读不到凭证，代价是要防 CSRF。

**2. Cookie 有 CSRF 风险，为什么大厂还偏爱它？**

CSRF 有 `SameSite`、自定义请求头这类成熟的机制可以防住；XSS 却很难保证百分之百杜绝，而且一旦发生，JS 能读到的长期凭证会被直接带走。

**3. SSO 是怎么跨域的？**

它不共享 Cookie，而是共享认证中心：每个系统都把用户送到认证中心验明身份，认证中心用一次性票据把结果带回来，各系统再建立自己的会话。

**4. OAuth 为什么先给 code，而不直接给 token？**

code 要经过浏览器跳转，可能留在地址栏和历史记录里。它一次性、短时效，还必须配合只存在服务端的 AppSecret 才能换到 token，所以真正的凭证从不经过浏览器。

**5. 扫码登录为什么还要在手机上点确认？**

扫码只表示「我看到了这个码」，确认才表示「我同意在这台电脑上登录」。少了这一步，扫了别人发来的码，就等于把账号拱手让人。

---

## 参考资料

- [RFC 10017：OAuth 2.0 for Browser-Based Applications](https://www.rfc-editor.org/rfc/rfc10017.html)
- [Protecting Cookies with Device Bound Session Credentials（Google 安全博客）](https://blog.google/security/protecting-cookies-with-device-bound-session-credentials/)
- [Google 不再淘汰第三方 Cookie（Usercentrics）](https://usercentrics.com/knowledge-hub/google-third-party-cookies/)
- [模拟淘宝、天猫的单点登录（GitHub）](https://github.com/xieyucan/mysso)
- [XBoot 单点登录文档：跨域设置 Cookie 模式](https://www.kancloud.cn/exrick/xboot/1399479)
- [Safari 下淘宝频繁要求重新登录（V2EX）](https://www.v2ex.com/t/548327)
- [Authing：CAS 术语与流程](https://docs.authing.cn/v2/frameworks/spring-security-cas/)
- [微信小程序 code2Session](https://developers.weixin.qq.com/miniprogram/dev/server/API/user-login/api_code2session)
- [微信网站应用扫码登录流程](https://cloud.tencent.com/developer/article/1985478)
- [小程序手机号验证组件收费（IT之家）](https://www.ithome.com/0/702/003.htm)
- [App Store 审核指南 4.8 Login Services（Apple 开发者论坛）](https://developer.apple.com/forums/thread/762647)
- [扫码登录的原理（Authing）](https://docs.authing.cn/v2/concepts/how-qrcode-works.html)
- [阿里云号码认证 H5 运营商限制](https://help.aliyun.com/zh/pnvs/developer-reference/number-authentication-h5-client-operator-restrictions)
- [极验一键认证常见问题](https://docs.geetest.com/onelogin/help/faq)
- [短信验证码表单最佳实践（web.dev）](https://web.dev/articles/sms-otp-form)
