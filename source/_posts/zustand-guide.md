---
title: Zustand 指南：最佳实践与实现原理
date: 2026-05-17 16:00:00
tags:
  - 前端
  - React
  - 状态管理
  - Zustand
  - TypeScript
categories:
  - 前端
description: 面向 React 开发者的 Zustand 完整手册。第一部分覆盖中大型项目的最佳实践——store 设计、性能优化、中间件、TypeScript 与常见陷阱；第二部分剖析其实现原理，用约 30 行代码手写一个简易 Zustand。
cover: https://picsum.photos/seed/zustand-guide/800/450
---

> 一份面向 React 开发者的 Zustand 完整手册。第一部分是中大型项目的**最佳实践**(store 设计、性能、TypeScript、常见陷阱等);第二部分剖析其**实现原理**,带你用 ~30 行代码写出一个简易 Zustand。

---

## 目录

- [最佳实践](#最佳实践)
  - [一、核心概念回顾](#一核心概念回顾)
  - [二、Store 设计原则](#二store-设计原则)
  - [三、多变量订阅的几种写法](#三多变量订阅的几种写法)
  - [四、性能最佳实践](#四性能最佳实践)
  - [五、中间件深入](#五中间件深入)
  - [六、`useStore.subscribe` 高级用法](#六usestoresubscribe-高级用法)
  - [七、TypeScript 最佳实践](#七typescript-最佳实践)
  - [八、推荐目录结构](#八推荐目录结构)
  - [九、常见陷阱清单](#九常见陷阱清单)
  - [十、和其他工具的配合](#十和其他工具的配合)
  - [十一、完整模板](#十一完整模板)
  - [十二、核心心法总结](#十二核心心法总结)
- [实现原理与简易实现](#实现原理与简易实现)
  - [1. Zustand 的核心原理](#1-zustand-的核心原理)
  - [2. 最小可用版本:30 行代码](#2-最小可用版本30-行代码)
  - [3. 逐部分拆解](#3-逐部分拆解)
  - [4. 几个值得思考的细节](#4-几个值得思考的细节)

---

## 最佳实践

### 一、核心概念回顾

Zustand 是一个轻量(~1KB)、基于 Hooks 的 React 状态管理库。它的核心优势:

- **无 Provider**:不需要包裹应用
- **精准订阅**:只有订阅的字段变化才会重渲染
- **组件外可用**:在工具函数、回调里直接读写状态
- **TypeScript 友好**:类型推导完善
- **中间件生态完善**:`persist`、`devtools`、`immer` 等开箱即用

最小示例:

```js
import { create } from 'zustand'

const useStore = create((set) => ({
  count: 0,
  increment: () => set((s) => ({ count: s.count + 1 })),
}))

function Counter() {
  const count = useStore((s) => s.count)
  const increment = useStore((s) => s.increment)
  return <button onClick={increment}>{count}</button>
}
```

---

### 二、Store 设计原则

#### 1. State 和 Actions 分离

把所有修改逻辑收拢到 `actions` 对象里,而不是平铺在 state 同一层。

```js
// ❌ 不推荐:state 和 action 混在一起
const useStore = create((set) => ({
  count: 0,
  user: null,
  increment: () => set(...),
  setUser: () => set(...),
  reset: () => set(...),
}))

// ✅ 推荐:分离
const useStore = create((set, get) => ({
  // state
  count: 0,
  user: null,

  // actions
  actions: {
    increment: () => set((s) => ({ count: s.count + 1 })),
    setUser: (user) => set({ user }),
    reset: () => set({ count: 0, user: null }),
  },
}))
```

**好处:**

- actions 引用稳定,组件可以一次性 `useStore(s => s.actions)` 取出,不会因为 state 变化而重渲染
- 语义清晰,一眼能看出哪些是数据、哪些是操作
- 重构时容易识别副作用边界

#### 2. 一个 Store 一个职责

不要把所有状态都塞到一个巨型 store 里。按业务领域拆分:

```
useAuthStore     // 登录、token、当前用户
useCartStore     // 购物车
useUIStore       // 主题、侧边栏、Modal 状态
useSettingsStore // 用户偏好设置
```

#### 3. Slice 模式

如果一个领域很大但仍然需要在一个 store 里(比如要共享某些字段),用 **Slice 模式** 组合:

```ts
// authSlice.ts
export const createAuthSlice = (set, get) => ({
  user: null,
  login: async (...) => { ... },
  logout: () => set({ user: null }),
})

// cartSlice.ts —— get 可用来访问其他 slice 的状态(例如下单时读 auth.user)
export const createCartSlice = (set, get) => ({
  items: [],
  addItem: (item) => set((s) => ({ items: [...s.items, item] })),
  checkout: async () => {
    const user = get().user  // 跨 slice 访问
    // ...
  },
})

// store.ts
const useStore = create((...args) => ({
  ...createAuthSlice(...args),
  ...createCartSlice(...args),
}))
```

Slice 之间可以通过 `get()` 互相访问,但要避免循环依赖。

#### 4. 导出预定义选择器 Hook

不要让消费组件直接写 `useStore(s => s.xxx)`,把选择器封装成 hook 暴露出去:

```ts
// stores/userStore.ts
const useUserStore = create(...)

// 数据选择器
export const useUser = () => useUserStore((s) => s.user)
export const useIsLoggedIn = () => useUserStore((s) => !!s.user)
export const useUserName = () => useUserStore((s) => s.user?.name)

// actions 选择器(引用稳定)
export const useUserActions = () => useUserStore((s) => s.actions)
```

组件用起来:

```jsx
function Header() {
  const userName = useUserName()
  const { logout } = useUserActions()
  return <button onClick={logout}>{userName} 退出</button>
}
```

**好处:** 重构 store 内部结构时,组件代码完全不用改,只改这一层选择器。

---

### 三、多变量订阅的几种写法

#### 写法 1:分多次调用(最推荐)

```jsx
function Profile() {
  const name = useStore((s) => s.name)
  const age = useStore((s) => s.age)
  const email = useStore((s) => s.email)
  return <div>{name}</div>
}
```

每个变量单独订阅,每个都是独立的浅比较,性能最好,写起来也最清晰。这是 Zustand 官方文档现在主推的方式。

#### 写法 2:使用 `useShallow`(批量订阅推荐)

```jsx
import { useShallow } from 'zustand/react/shallow'

function Profile() {
  const { name, age, email } = useStore(
    useShallow((s) => ({
      name: s.name,
      age: s.age,
      email: s.email,
    }))
  )
  return <div>{name}, {age}</div>
}
```

也支持数组形式:

```jsx
const [name, age, email] = useStore(
  useShallow((s) => [s.name, s.age, s.email])
)
```

⚠️ **关键陷阱:** 如果不用 `useShallow` 直接返回对象,每次渲染都会创建新对象,默认的 `Object.is` 比较会认为永远不相等,导致**每次任何状态变化都重渲染**:

```jsx
// ❌ 错误!每次任意状态变化都会重渲染
const { name, age } = useStore((s) => ({ name: s.name, age: s.age }))

// ✅ 正确
const { name, age } = useStore(useShallow((s) => ({ name: s.name, age: s.age })))
```

#### 补充:actions 不在多变量订阅的烦恼里

按前面「[State 和 Actions 分离](#1-state-和-actions-分离)」的设计,`actions` 对象引用全程稳定,一次性解构无需 `useShallow`:

```jsx
// actions 引用不变,直接取整个对象,不会触发额外渲染
const { increment, setUser } = useStore((s) => s.actions)
```

这是 actions 集中设计在订阅层面的额外收益——多个 action 共用时完全不用担心重渲染问题。

---

### 四、性能最佳实践

#### 1. 选择器要"窄"

只订阅你真正需要的字段,不要返回大对象:

```jsx
// ❌ 任何 user 字段变化都会重渲染
const user = useStore((s) => s.user)
return <div>{user.name}</div>

// ✅ 只有 name 变化才重渲染
const name = useStore((s) => s.user.name)
```

#### 2. 派生数据放选择器里,不要放 state

```js
// ❌ 不要把派生值塞进 state
{
  items: [...],
  totalPrice: 0, // 每次 items 变都要手动同步
}

// ✅ 用选择器派生
{
  items: [...]
}

// 组件中
const totalPrice = useStore((s) =>
  s.items.reduce((sum, item) => sum + item.price, 0)
)
```

如果派生计算昂贵,可以配合 `useMemo` 或者 reselect 类库做缓存。

⚠️ **注意派生返回值的类型:** 上面例子返回的是数字(原始类型),`Object.is` 比较没问题。如果派生返回**对象或数组**,每次选择器执行都会产生新引用,需要 `useShallow`:

```jsx
import { useShallow } from 'zustand/react/shallow'

// ❌ 每次返回新数组,引用不等,组件每次任意 state 变化都重渲染
const cheapItems = useStore((s) => s.items.filter((i) => i.price < 100))

// ✅ 浅比较数组元素
const cheapItems = useStore(
  useShallow((s) => s.items.filter((i) => i.price < 100))
)
```

#### 3. 高频更新绕开 React 渲染

如果某个状态变化非常频繁(鼠标位置、滚动、动画进度),不要走 React 渲染,用 `subscribe` 直接操作 DOM(下面这种带选择器的形式需要 `subscribeWithSelector` 中间件,见 [第六章](#六usestoresubscribe-高级用法)):

```jsx
function Cursor() {
  const ref = useRef(null)

  useEffect(() => {
    return useStore.subscribe(
      (state) => state.position,
      (position) => {
        ref.current.style.transform =
          `translate(${position.x}px, ${position.y}px)`
      }
    )
  }, [])

  return <div ref={ref} />
}
```

这种"绕开 React"的更新模式是 Zustand 的杀手锏之一。

---

### 五、中间件深入

#### `immer` —— 简化嵌套更新

```js
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

const useStore = create(
  immer((set) => ({
    user: { profile: { name: '', age: 0 } },
    updateName: (name) =>
      set((state) => {
        state.user.profile.name = name  // 可以直接"修改"
      }),
  }))
)
```

#### `persist` —— 持久化

```js
import { persist, createJSONStorage } from 'zustand/middleware'

const useStore = create(
  persist(
    (set) => ({ token: null, setToken: (t) => set({ token: t }) }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => sessionStorage), // 默认 localStorage
      partialize: (state) => ({ token: state.token }), // 只持久化某些字段
      version: 1,
      migrate: (persistedState, version) => { /* 版本迁移 */ },
    }
  )
)
```

#### `devtools` —— Redux DevTools 调试

```js
import { devtools } from 'zustand/middleware'

const useStore = create(
  devtools(
    (set) => ({
      count: 0,
      // 第三个参数给 action 命名,DevTools 里能看到
      increment: () =>
        set((s) => ({ count: s.count + 1 }), false, 'increment'),
    }),
    { name: 'CounterStore' }
  )
)
```

`set` 的第三个参数是 action 名字,强烈建议每个 action 都加上,否则 DevTools 里全是 `anonymous` 完全没法调试。

#### 组合多个中间件

顺序很重要,`devtools` 通常在最外层:

```js
const useStore = create(
  devtools(
    persist(
      immer((set) => ({ ... })),
      { name: 'storage' }
    ),
    { name: 'MyStore' }
  )
)
```

---

### 六、`useStore.subscribe` 高级用法

`subscribe` 让你在 React 渲染流程**之外**响应状态变化。和 `useStore(selector)` 的区别:

| 维度 | `useStore(selector)` | `useStore.subscribe(listener)` |
|---|---|---|
| 使用位置 | React 组件内 | 任何地方 |
| 触发效果 | 组件重渲染 | 执行回调函数 |
| 典型用途 | 渲染 UI | 副作用、DOM 操作、桥接外部系统 |

#### 基础订阅

```js
const unsub = useStore.subscribe((state, prevState) => {
  console.log('state 变化了', state, prevState)
})
unsub() // 取消订阅
```

#### 选择器订阅(推荐)

需要 `subscribeWithSelector` 中间件:

```js
import { subscribeWithSelector } from 'zustand/middleware'
import { shallow } from 'zustand/shallow'

const useStore = create(
  subscribeWithSelector((set) => ({
    count: 0,
    user: null,
  }))
)

const unsub = useStore.subscribe(
  (state) => state.count,        // 选择器
  (count, prevCount) => {        // 监听器
    console.log('count:', prevCount, '→', count)
  },
  {
    equalityFn: shallow,         // 可选,订阅对象/数组时用浅比较
    fireImmediately: true,       // 可选,订阅时立即触发一次
  }
)
```

#### 典型场景

**跨 store 联动:**

```js
// 用户登出时,清空购物车
useUserStore.subscribe(
  (s) => s.user,
  (user) => {
    if (!user) useCartStore.getState().actions.clear()
  }
)
```

**桥接外部系统:**

```js
useStore.subscribe(
  (s) => s.user,
  (user) => {
    if (user) socket = new WebSocket(`wss://api.com/?token=${user.token}`)
    else socket?.close()
  },
  { fireImmediately: true }
)
```

**Bridge 组件(把状态变化桥接到 toast 等系统):**

```jsx
function NotificationBridge() {
  useEffect(() => {
    return useStore.subscribe(
      (s) => s.error,
      (error) => error && toast.error(error.message)
    )
  }, [])
  return null
}
```

⚠️ 在组件里订阅时,**一定要返回 `unsub`**,否则会泄露订阅。

---

### 七、TypeScript 最佳实践

#### 1. 用柯里化写法

```ts
import { create } from 'zustand'

interface UserState {
  user: User | null
  loading: boolean
  actions: {
    fetchUser: (id: string) => Promise<void>
    logout: () => void
  }
}

const useUserStore = create<UserState>()((set, get) => ({
  user: null,
  loading: false,
  actions: {
    fetchUser: async (id) => {
      set({ loading: true })
      const user = await api.getUser(id)
      set({ user, loading: false })
    },
    logout: () => set({ user: null }),
  },
}))
```

⚠️ 注意 `create<UserState>()(...)` 这种**柯里化写法**——`create` 后面跟一对空括号再调用,这是 Zustand v4+ 推荐的 TS 写法,中间件链路的类型推导才能正确工作。

#### 2. Slice 模式的类型

```ts
import { StateCreator } from 'zustand'

interface AuthSlice {
  user: User | null
  login: (email: string) => Promise<void>
}

interface CartSlice {
  items: Item[]
  addItem: (item: Item) => void
}

type Store = AuthSlice & CartSlice

const createAuthSlice: StateCreator<Store, [], [], AuthSlice> = (set) => ({
  user: null,
  login: async (email) => { ... },
})

const createCartSlice: StateCreator<Store, [], [], CartSlice> = (set) => ({
  items: [],
  addItem: (item) => set((s) => ({ items: [...s.items, item] })),
})

export const useStore = create<Store>()((...a) => ({
  ...createAuthSlice(...a),
  ...createCartSlice(...a),
}))
```

---

### 八、推荐目录结构

```
src/
  stores/
    index.ts              // 统一导出
    userStore.ts          // 用户相关
    cartStore.ts          // 购物车
    uiStore.ts            // UI 状态
    slices/               // 大型 store 拆分
      authSlice.ts
      profileSlice.ts
    middleware/           // 自定义中间件
      logger.ts
```

每个 store 文件结构建议:

```ts
// userStore.ts
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

// 1. 类型定义
interface UserState { ... }

// 2. 初始状态
const initialState = {
  user: null,
  loading: false,
}

// 3. store
const useUserStore = create<UserState>()(
  devtools(
    persist(
      immer((set, get) => ({
        ...initialState,
        actions: { ... },
      })),
      { name: 'user-storage', partialize: (s) => ({ user: s.user }) }
    ),
    { name: 'UserStore' }
  )
)

// 4. 选择器 hooks
export const useUser = () => useUserStore((s) => s.user)
export const useUserActions = () => useUserStore((s) => s.actions)

// 5. 组件外部访问(可选)
export const userStore = useUserStore
```

---

### 九、常见陷阱清单

#### ❌ 选择器返回新对象不加 `useShallow`

```jsx
const { a, b } = useStore((s) => ({ a: s.a, b: s.b })) // 每次都重渲染
```

#### ❌ 在组件渲染期间调用 action

```jsx
function Comp() {
  useStore.getState().fetchData() // ❌ 副作用,应放 useEffect
}
```

#### ❌ 把整个 store 当 props 传

```jsx
<Child store={useStore()} /> // ❌ 失去精准订阅
```

#### ❌ 用对象式 set 时漏写字段

```jsx
set({ count: 5 }, true) // ❌ 第二个参数 true 会丢失其他字段
```

#### ❌ 在 SSR(Next.js)里直接用全局 store

服务端每次请求要新建 store,否则用户数据会串。建议用 Context + 工厂函数:

```ts
export const createUserStore = () => create<State>()(...)

// Provider 中
const storeRef = useRef()
if (!storeRef.current) storeRef.current = createUserStore()
```

#### ❌ Action 里直接 mutate state(没用 immer 时)

```js
set((s) => { s.count++; return s }) // ❌
```

#### ❌ `subscribe` 后忘记取消订阅

```jsx
useEffect(() => {
  useStore.subscribe(...)  // ❌ 没返回 unsub
}, [])

// 正确
useEffect(() => {
  const unsub = useStore.subscribe(...)
  return unsub  // ✅
}, [])
```

#### ❌ 在 `subscribe` 回调里改同一个字段

```js
useStore.subscribe(
  (s) => s.count,
  (count) => useStore.setState({ count: count + 1 })  // ❌ 无限循环
)
```

---

### 十、和其他工具的配合

**和 React Query 配合:** 服务端数据交给 React Query,Zustand 只管纯客户端状态(UI、表单草稿、用户偏好等)。两者职责清晰,不要把请求结果手动同步到 Zustand。

**和 React Router 配合:** 不要把路由参数复制到 Zustand,用 `useParams` 就好。Zustand 适合存"导航之外要保持的状态"。

**和表单库配合:** 简单表单用 React Hook Form 就够,Zustand 适合存跨多步骤、跨页面的表单草稿。

---

### 十一、完整模板

一个完整的购物车 store,涵盖类型、中间件、选择器 hook、actions 分离等所有最佳实践:

```ts
// stores/cartStore.ts
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

interface CartItem {
  id: string
  name: string
  price: number
  quantity: number
}

interface CartState {
  items: CartItem[]
  isOpen: boolean
  actions: {
    addItem: (item: Omit<CartItem, 'quantity'>) => void
    removeItem: (id: string) => void
    updateQuantity: (id: string, qty: number) => void
    clear: () => void
    toggle: () => void
  }
}

const useCartStore = create<CartState>()(
  devtools(
    persist(
      immer((set) => ({
        items: [],
        isOpen: false,
        actions: {
          addItem: (item) =>
            set((s) => {
              const existing = s.items.find((i) => i.id === item.id)
              if (existing) existing.quantity++
              else s.items.push({ ...item, quantity: 1 })
            }),
          removeItem: (id) =>
            set((s) => {
              s.items = s.items.filter((i) => i.id !== id)
            }),
          updateQuantity: (id, qty) =>
            set((s) => {
              const item = s.items.find((i) => i.id === id)
              if (item) item.quantity = qty
            }),
          clear: () => set((s) => { s.items = [] }),
          toggle: () => set((s) => { s.isOpen = !s.isOpen }),
        },
      })),
      {
        name: 'cart-storage',
        partialize: (s) => ({ items: s.items }), // 不持久化 isOpen
      }
    ),
    { name: 'CartStore' }
  )
)

// 选择器 hooks
export const useCartItems = () => useCartStore((s) => s.items)
export const useCartCount = () =>
  useCartStore((s) => s.items.reduce((n, i) => n + i.quantity, 0))
export const useCartTotal = () =>
  useCartStore((s) => s.items.reduce((sum, i) => sum + i.price * i.quantity, 0))
export const useCartIsOpen = () => useCartStore((s) => s.isOpen)
export const useCartActions = () => useCartStore((s) => s.actions)

// 组件外部访问
export const cartStore = useCartStore
```

组件中使用:

```jsx
function CartIcon() {
  const count = useCartCount()
  const { toggle } = useCartActions()
  return <button onClick={toggle}>🛒 {count}</button>
}

function CartPanel() {
  const items = useCartItems()
  const total = useCartTotal()
  const { removeItem, clear } = useCartActions()

  return (
    <div>
      {items.map((item) => (
        <div key={item.id}>
          {item.name} × {item.quantity}
          <button onClick={() => removeItem(item.id)}>删除</button>
        </div>
      ))}
      <div>合计: ¥{total}</div>
      <button onClick={clear}>清空</button>
    </div>
  )
}
```

---

### 十二、核心心法总结

把这五条守住,Zustand 项目几乎不会出大坑:

1. **State 和 Actions 分离** —— 把 actions 放进独立对象
2. **选择器要"窄"** —— 只订阅真正需要的字段
3. **派生数据用 selector** —— 不要塞进 state 手动同步
4. **按职责拆 store** —— 一个 store 一个领域,大领域用 Slice 模式
5. **对外只暴露 hook** —— 用预定义选择器封装,屏蔽内部结构

---

## 实现原理与简易实现

> 这一部分是给已经掌握用法的读者准备的。理解 Zustand 的内部实现能让你对 React 状态管理的本质有更深的认识——它的核心代码其实就一两百行。

### 1. Zustand 的核心原理

剥开所有中间件和便利 API,Zustand 的本质就是三件事:

**(1) 一个发布订阅模式的 store**

store 内部维护当前 state 和一组 listeners。调用 `setState` 时,更新 state 并通知所有 listener。

**(2) 用 React 的 `useSyncExternalStore` 把外部 store 接入组件**

这是 React 18 提供的官方 API,专门用来订阅"React 外部的可变数据源"。Zustand v4 之后底层就是用它。

**(3) selector + 比较函数做精准订阅**

每个组件订阅时传入一个 selector,只有 selector 返回值变化(默认 `Object.is` 比较)才触发组件重渲染。

就这三件事。其他像 `persist`、`devtools`、`immer` 都是在这之上叠的中间件。

### 2. 最小可用版本:30 行代码

先写一个最简版本,只支持基础功能:

```js
import { useSyncExternalStore } from 'react'

function create(createState) {
  let state           // 当前状态
  const listeners = new Set()   // 所有订阅者

  // 更新 state 的方法
  const setState = (partial, replace) => {
    // partial 可以是函数或对象
    const nextPartial =
      typeof partial === 'function' ? partial(state) : partial

    // 浅合并(replace=true 时直接替换)
    const nextState = replace
      ? nextPartial
      : Object.assign({}, state, nextPartial)

    // 只有真的变了才通知
    if (!Object.is(nextState, state)) {
      const prevState = state
      state = nextState
      listeners.forEach((listener) => listener(state, prevState))
    }
  }

  // 读取当前 state
  const getState = () => state

  // 添加监听器,返回取消函数
  const subscribe = (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  // 把上面方法都暴露给 createState,让用户定义 state 和 actions
  const api = { setState, getState, subscribe }
  state = createState(setState, getState, api)

  // 返回的 hook
  const useStore = (selector = (s) => s) => {
    return useSyncExternalStore(
      subscribe,
      () => selector(getState()),
      () => selector(getState())  // SSR 用,这里简化
    )
  }

  // 把 api 挂到 hook 上,实现 useStore.getState()、useStore.subscribe()
  Object.assign(useStore, api)

  return useStore
}

export { create }
```

测试一下:

```jsx
const useCounter = create((set) => ({
  count: 0,
  increment: () => set((s) => ({ count: s.count + 1 })),
}))

function App() {
  const count = useCounter((s) => s.count)
  const increment = useCounter((s) => s.increment)
  return <button onClick={increment}>{count}</button>
}
```

跑起来效果跟真 Zustand 一模一样。这就是全部核心。

### 3. 逐部分拆解

#### 3.1 发布订阅模式

整个 store 就是经典的 pub-sub:

```js
const listeners = new Set()

const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const notify = () => {
  listeners.forEach((listener) => listener(state, prevState))
}
```

用 `Set` 是因为它天然去重、删除快。

#### 3.2 `setState` 的设计

`setState` 接受两种参数形态:

```js
// 对象形式
setState({ count: 5 })

// 函数形式(基于最新 state)
setState((s) => ({ count: s.count + 1 }))
```

实现里先判断:

```js
const nextPartial =
  typeof partial === 'function' ? partial(state) : partial
```

然后合并(注意是**浅合并**,这跟 Redux 完全替换不同):

```js
const nextState = replace
  ? nextPartial
  : Object.assign({}, state, nextPartial)
```

最后必须**创建新的 state 对象**(`Object.assign({}, ...)`),不能直接 mutate 原对象。这是为什么 selector 能用 `Object.is` 比较 —— 引用变了才说明状态变了。

#### 3.3 `useSyncExternalStore` 是关键

```js
const useStore = (selector) =>
  useSyncExternalStore(
    subscribe,                        // 怎么订阅
    () => selector(getState()),       // 怎么取当前快照
    () => selector(getState())        // 服务端怎么取(SSR)
  )
```

这个 React 内置 hook 做了三件事:

- 组件挂载时调用 `subscribe(listener)`,store 一变就触发 listener,React 内部决定要不要重渲染
- 每次渲染调用第二个参数(getSnapshot)拿当前值
- React 自动做"快照值相等就不重渲染"的优化(用 `Object.is`)

这意味着 **selector 的精准订阅根本不需要我们手写**,完全是 React 内部基于快照比较实现的。这也是 Zustand 在 v4 重写的重要动机:之前自己用 `useState + useEffect` 实现订阅,容易在并发模式下出 bug,改用 `useSyncExternalStore` 后就交给 React 处理了。

#### 3.4 把 api 挂到 hook 上

```js
Object.assign(useStore, { setState, getState, subscribe })
```

这一步让你能写 `useStore.getState()`、`useStore.subscribe(...)`。函数也是对象,可以挂属性 —— JavaScript 的小巧思。

### 4. 几个值得思考的细节

**为什么 Zustand 不用 Context?**

Context 的"任意变化都通知所有消费者"机制无法做精准订阅。即便用 selector,React 也会让所有 `useContext` 的组件重渲染再去比较 —— 这就是为什么 React 官方推荐用 `useSyncExternalStore` 做外部状态管理。Zustand 的 pub-sub 让每个组件单独订阅,变化时只通知"真正关心这部分数据"的组件。

**为什么 set 必须返回新对象?**

因为 selector 比较依赖引用相等。如果 mutate 原对象,引用没变,`Object.is(prev, next)` 还是 true,组件不会更新。这也是为什么 `immer` 中间件存在 —— 它在内部帮你 mutate,然后返回新对象,二者兼得。

**listeners 用数组还是 Set?**

Zustand 用 Set。原因:订阅/取消订阅频繁,Set 的 `add`/`delete` 都是 O(1);而且 Set 不会出现"同一个 listener 注册两次"的问题。代价是不保证遍历顺序,但对 pub-sub 来说顺序不重要。

---

## 参考资源

- [Zustand 官方文档](https://github.com/pmndrs/zustand)
- [TypeScript 指南](https://github.com/pmndrs/zustand/blob/main/docs/guides/typescript.md)
- [SSR 与 Hydration](https://github.com/pmndrs/zustand/blob/main/docs/guides/ssr-and-hydration.md)
- [测试指南](https://github.com/pmndrs/zustand/blob/main/docs/guides/testing.md)
