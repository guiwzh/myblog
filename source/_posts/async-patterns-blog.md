---
title: 前端异步请求实战：竞态、并发与清理
date: 2026-05-07 15:00:00
tags:
  - 前端
  - React
  - 异步
  - axios
categories:
  - 前端
description: 聚焦前端异步请求中最具实战价值的三个难题——竞态条件、并发控制、取消与清理，基于 axios 与 AbortController 给出可直接落地到 React 项目的解决方案。
---

在前端开发中，异步请求远不止调一个接口那么简单。当你的应用复杂到一定程度，竞态条件会让搜索框显示错误的结果，不受控的并发会把服务器打崩，而组件卸载后幽灵般的 `setState` 会在控制台留下刺眼的警告。

这篇文章聚焦三个最具实战价值的异步难题——竞态条件、并发控制、取消与清理——基于 axios，给出可以直接落地到 React 项目中的解决方案。

> 本文所有示例均使用 axios。axios 从 v0.22.0 起支持 `AbortController`，这也是官方推荐的取消方式，早期的 `CancelToken` 已被废弃。

---

## 一、竞态条件：最后发出的请求，未必最后到达

### 问题场景

用户在搜索框里快速输入 "R" → "Re" → "Rea" → "React"，每次输入都会触发一次搜索请求。由于网络延迟不确定，"Re" 的请求可能比 "React" 的请求更晚返回，于是界面上显示的是 "Re" 的搜索结果——而用户期望看到的是 "React"。

这就是经典的竞态条件（Race Condition）。它的根源在于：**请求的发出顺序和返回顺序不一致。**

### 解法一：AbortController 取消过期请求

最直接的思路是，每次发出新请求前，把上一次还没返回的请求取消掉。axios 支持通过 `signal` 选项接入原生的 `AbortController`。

```jsx
import { useState, useRef, useCallback } from 'react';
import axios from 'axios';

function useSearch() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const abortControllerRef = useRef(null);

  const search = useCallback(async (keyword) => {
    // 1. 取消上一次请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // 2. 为本次请求创建新的 AbortController
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);

    try {
      const { data } = await axios.get('/api/search', {
        params: { q: keyword },
        signal: controller.signal,
      });

      // 3. 走到这里说明请求没被取消，放心更新状态
      setResults(data.items);
    } catch (error) {
      if (axios.isCancel(error)) {
        // 请求被取消是正常流程，静默忽略
        return;
      }
      // 其他错误正常抛出
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  return { results, loading, search };
}
```

调用 `controller.abort()` 后，axios 会立即 reject 一个 `CanceledError`（可通过 `axios.isCancel(error)` 统一判断）。后续的 `setResults` 不会执行，从根本上杜绝了过期数据覆盖新数据的问题。

### 解法二：请求序号（无需取消的轻量方案）

有些场景下，你可能不想取消请求（比如希望保留缓存），只是想确保 UI 只展示最新一次请求的结果。这时可以用一个递增的序号来标记请求：

```jsx
function useLatestSearch() {
  const [results, setResults] = useState([]);
  const requestIdRef = useRef(0);

  const search = useCallback(async (keyword) => {
    // 每次搜索递增序号
    const currentId = ++requestIdRef.current;

    const { data } = await axios.get('/api/search', {
      params: { q: keyword },
    });

    // 只有当序号仍然是最新的，才更新 UI
    if (currentId === requestIdRef.current) {
      setResults(data.items);
    }
    // 否则说明有更新的请求已经发出，丢弃本次结果
  }, []);

  return { results, search };
}
```

两种方案的取舍：AbortController 实际取消了网络请求，节省了带宽和服务端资源；序号方案实现更简单，适合请求本身有缓存价值的场景。实际项目中我更推荐 AbortController，因为它是浏览器原生标准，axios 对其有开箱即用的支持。

### 在 React 组件中使用

```jsx
function SearchBox() {
  const [keyword, setKeyword] = useState('');
  const { results, loading, search } = useSearch();

  useEffect(() => {
    if (keyword.length === 0) return;

    const timer = setTimeout(() => {
      search(keyword);
    }, 300); // debounce 300ms

    return () => clearTimeout(timer);
  }, [keyword, search]);

  return (
    <div>
      <input
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="搜索..."
      />
      {loading && <p>加载中...</p>}
      <ul>
        {results.map((item) => (
          <li key={item.id}>{item.title}</li>
        ))}
      </ul>
    </div>
  );
}
```

注意这里 debounce 和 AbortController 是互补而非替代的关系。Debounce 减少请求发出的次数，AbortController 确保即使请求已经发出，也不会因为返回顺序问题导致 UI 错乱。

---

## 二、并发控制：别把服务器打崩了

### 问题场景

用户需要批量上传 200 张图片。最朴素的写法是把 200 个 upload 请求一口气全发出去：

```js
// 千万别这么写
const promises = files.map((file) => uploadFile(file));
await Promise.all(promises);
```

结果：浏览器同时发出 200 个请求，服务端被瞬时流量冲垮返回大量 503，浏览器本身也会因为连接数限制排队阻塞，用户看到的是长时间的白屏。

### 解决方案：并发池

核心思路是维护一个"正在执行"的计数器。当计数器达到上限时，新任务排队等待；有任务完成后，自动唤醒队列中的下一个。

```js
class ConcurrencyPool {
  constructor(limit) {
    this.limit = limit;
    this.running = 0;
    this.queue = [];
  }

  async add(taskFn) {
    // 达到上限，排队等待
    if (this.running >= this.limit) {
      await new Promise((resolve) => this.queue.push(resolve));
    }

    this.running++;
    try {
      return await taskFn();
    } finally {
      this.running--;
      // 完成后唤醒队列头部的任务
      if (this.queue.length > 0) {
        this.queue.shift()();
      }
    }
  }
}
```

这段代码的精妙之处在于对 Promise 的运用：当并发数已满时，`new Promise` 创建一个"挂起"的 Promise，它的 `resolve` 被存入队列。只有当某个任务完成、调用 `this.queue.shift()()` 时，这个 Promise 才会 resolve，对应的任务才会继续执行。

### 封装成 React Hook

```jsx
import { useState, useCallback, useRef } from 'react';
import axios from 'axios';

function useConcurrentUpload(limit = 3) {
  const [tasks, setTasks] = useState([]);
  const poolRef = useRef(new ConcurrencyPool(limit));

  const updateTask = useCallback((id, updates) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
  }, []);

  const upload = useCallback(async (files) => {
    // 初始化任务状态
    const initialTasks = files.map((file, index) => ({
      id: index,
      name: file.name,
      status: 'pending',   // pending | running | done | error
      progress: 0,
    }));
    setTasks(initialTasks);

    const promises = files.map((file, index) =>
      poolRef.current.add(async () => {
        updateTask(index, { status: 'running' });

        const formData = new FormData();
        formData.append('file', file);

        try {
          await axios.post('/api/upload', formData, {
            // axios 原生支持上传进度回调
            onUploadProgress: (e) => {
              const progress = Math.round((e.loaded / e.total) * 100);
              updateTask(index, { progress });
            },
          });
          updateTask(index, { status: 'done', progress: 100 });
        } catch (error) {
          updateTask(index, {
            status: 'error',
            error: error.message,
          });
        }
      })
    );

    return Promise.allSettled(promises);
  }, [updateTask]);

  return { tasks, upload };
}
```

使用方式非常直观：

```jsx
function BatchUploader() {
  const { tasks, upload } = useConcurrentUpload(3);
  const inputRef = useRef(null);

  const handleSelect = (e) => {
    const files = Array.from(e.target.files);
    upload(files);
  };

  return (
    <div>
      <input ref={inputRef} type="file" multiple onChange={handleSelect} />
      <button onClick={() => inputRef.current?.click()}>
        选择文件 (最大并发: 3)
      </button>
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            {task.name}: {task.status} {task.progress}%
          </li>
        ))}
      </ul>
    </div>
  );
}
```

这里利用了 axios 的一个优势——`onUploadProgress` 回调开箱即用，不需要像 `fetch` 那样手动通过 `ReadableStream` 计算进度。

### 进阶：支持全部取消

实际项目中，并发池往往还需要支持"一键取消所有任务"。核心是让池持有一个统一的 `AbortController`，所有通过池发出的请求都绑定到同一个 `signal` 上：

```js
class CancellablePool {
  constructor(limit) {
    this.limit = limit;
    this.running = 0;
    this.queue = [];
    this.abortController = new AbortController();
  }

  get signal() {
    return this.abortController.signal;
  }

  async add(taskFn) {
    if (this.abortController.signal.aborted) {
      throw new axios.CanceledError('Pool cancelled');
    }

    if (this.running >= this.limit) {
      await new Promise((resolve, reject) => {
        this.queue.push(resolve);
        // 如果等待期间被取消，reject 排队中的任务
        this.abortController.signal.addEventListener('abort', () => {
          reject(new axios.CanceledError('Pool cancelled'));
        });
      });
    }

    this.running++;
    try {
      // 把 signal 传给任务函数，任务内部转发给 axios
      return await taskFn(this.abortController.signal);
    } finally {
      this.running--;
      if (this.queue.length > 0) {
        this.queue.shift()();
      }
    }
  }

  cancelAll() {
    this.abortController.abort();
    this.queue = [];
  }
}
```

任务函数接收 `signal` 并传递给 axios：

```js
pool.add((signal) =>
  axios.post('/api/upload', formData, {
    signal,
    onUploadProgress: (e) => { /* ... */ },
  })
);
```

调用 `pool.cancelAll()` 就能一次性终止所有正在执行和排队中的任务。

---

## 三、取消与清理：组件卸载时，别留下幽灵请求

### 问题场景

用户进入一个详情页，页面发起了一个耗时较长的请求。在请求返回之前，用户点击返回按钮，组件卸载了。几秒后请求返回，尝试调用已经卸载的组件的 `setState`。在 React 18 之前，这会触发经典的警告：

> Can't perform a React state update on an unmounted component.

虽然 React 18 移除了这个警告，但问题本身并没有消失——未取消的请求仍然在消耗网络资源，响应回来后的回调仍然会执行不必要的逻辑。

### 基础方案：useEffect 清理函数 + AbortController

```jsx
import { useState, useEffect } from 'react';
import axios from 'axios';

function UserProfile({ userId }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadProfile() {
      setLoading(true);
      setError(null);

      try {
        const { data } = await axios.get(`/api/users/${userId}`, {
          signal: controller.signal,
        });
        setProfile(data);
      } catch (e) {
        if (axios.isCancel(e)) return; // 正常取消，不处理
        setError(e.message);
      } finally {
        // 如果被 abort，不应该 setLoading(false)
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadProfile();

    // 清理函数：组件卸载或 userId 变化时执行
    return () => controller.abort();
  }, [userId]);

  if (loading) return <Spinner />;
  if (error) return <ErrorMessage message={error} />;
  return <ProfileCard data={profile} />;
}
```

关键点在于 `useEffect` 的返回函数。React 保证在组件卸载时、以及下一次 effect 执行前，都会调用这个清理函数。把 `controller.abort()` 放在这里，就能确保：

1. 组件卸载时，进行中的请求被取消
2. `userId` 变化时，上一次请求被取消（这同时也解决了竞态问题）

### 多请求场景：共享一个 AbortController

当一个组件需要同时发起多个请求时，可以让所有请求共享同一个 `AbortController`，一次 abort 取消全部：

```jsx
function Dashboard() {
  const [state, setState] = useState({
    user: null,
    orders: null,
    notifications: null,
    loading: true,
  });

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function loadDashboard() {
      try {
        // 三个请求共享同一个 signal
        const [userRes, ordersRes, notifsRes] = await Promise.all([
          axios.get('/api/user', { signal }),
          axios.get('/api/orders', { signal }),
          axios.get('/api/notifications', { signal }),
        ]);

        setState({
          user: userRes.data,
          orders: ordersRes.data,
          notifications: notifsRes.data,
          loading: false,
        });
      } catch (e) {
        if (axios.isCancel(e)) return;
        console.error('Dashboard load failed:', e);
      }
    }

    loadDashboard();
    return () => controller.abort();
  }, []);

  // ...
}
```

`Promise.all` 有一个特性正好适用于这个场景：只要有一个 Promise reject，整个 `Promise.all` 就会 reject。因此只要 abort 信号触发，所有请求都会失败，统一进入 catch 分支。

### 封装通用 Hook：useAbortableEffect

如果项目中大量使用这种模式，可以封装一个通用 Hook 来减少样板代码：

```jsx
import axios from 'axios';

function useAbortableEffect(asyncFn, deps) {
  useEffect(() => {
    const controller = new AbortController();

    asyncFn(controller.signal).catch((e) => {
      if (!axios.isCancel(e)) {
        console.error('useAbortableEffect error:', e);
      }
    });

    return () => controller.abort();
  }, deps);
}
```

使用时代码变得非常简洁：

```jsx
function UserProfile({ userId }) {
  const [profile, setProfile] = useState(null);

  useAbortableEffect(
    async (signal) => {
      const { data } = await axios.get(`/api/users/${userId}`, { signal });
      setProfile(data);
    },
    [userId]
  );

  return profile ? <ProfileCard data={profile} /> : <Spinner />;
}
```

### 使用 axios 拦截器统一处理取消

在大型项目中，与其在每个 `catch` 里判断 `axios.isCancel`，不如在 axios 实例的响应拦截器中统一处理：

```js
const api = axios.create({ baseURL: '/api' });

// 响应拦截器：静默忽略取消错误
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isCancel(error)) {
      // 取消是正常流程，返回一个永远不会 resolve 的 Promise
      // 这样调用方的 .then() 和后续逻辑都不会执行
      return new Promise(() => {});
    }
    return Promise.reject(error);
  }
);
```

配合这个拦截器，业务代码可以完全不关心取消逻辑：

```jsx
useEffect(() => {
  const controller = new AbortController();

  // 不需要 try/catch 处理取消，拦截器已经兜底了
  api.get(`/users/${userId}`, { signal: controller.signal })
    .then(({ data }) => setProfile(data))
    .catch((e) => setError(e.message)); // 这里只会收到真正的错误

  return () => controller.abort();
}, [userId]);
```

> **注意**：拦截器中返回 `new Promise(() => {})` 是一种常见技巧。它让被取消的请求"悬停"在 pending 状态，调用方的 `.then()` 和 `.catch()` 都不会执行，效果等同于请求从未发出。

---

## 实战：三个模式组合使用

真实项目中，这三个问题往往同时出现。以一个"带搜索和批量操作的数据表格"为例：

```jsx
import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';

function DataTable() {
  const [searchTerm, setSearchTerm] = useState('');
  const [data, setData] = useState([]);
  const abortRef = useRef(null);

  // ─── 竞态 + 清理：搜索请求 ───
  useEffect(() => {
    if (!searchTerm) {
      setData([]);
      return;
    }

    // 取消上一次搜索（解决竞态）
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const timer = setTimeout(async () => {
      try {
        const { data: result } = await axios.get('/api/data', {
          params: { q: searchTerm },
          signal: controller.signal,
        });
        setData(result.items);
      } catch (e) {
        if (!axios.isCancel(e)) console.error(e);
      }
    }, 300);

    // 组件卸载时同时清除定时器和请求
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchTerm]);

  // ─── 并发控制：批量删除 ───
  const handleBatchDelete = useCallback(async (selectedIds) => {
    const pool = new ConcurrencyPool(5);

    const results = await Promise.allSettled(
      selectedIds.map((id) =>
        pool.add(() => axios.delete(`/api/data/${id}`))
      )
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      console.warn(`${failed.length} 个删除请求失败`);
    }

    // 删除完成后刷新当前搜索结果
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const { data: result } = await axios.get('/api/data', {
        params: { q: searchTerm },
        signal: controller.signal,
      });
      setData(result.items);
    } catch (e) {
      if (!axios.isCancel(e)) console.error(e);
    }
  }, [searchTerm]);

  return (
    <div>
      <input
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder="搜索..."
      />
      <Table
        data={data}
        onBatchDelete={handleBatchDelete}
      />
    </div>
  );
}
```

这个组件同时运用了三种模式：debounce + AbortController 处理搜索竞态，useEffect 清理函数处理组件卸载，ConcurrencyPool 控制批量删除的并发数。

---

## 补充：axios.isCancel 与 AbortError 的关系

使用 axios 时，判断请求是否被取消应始终使用 `axios.isCancel(error)` 而非 `error.name === 'AbortError'`。原因在于 axios 内部会将原生的 `AbortError` 包装为自己的 `CanceledError` 类型：

```js
// ✅ 正确：使用 axios 提供的判断方法
catch (error) {
  if (axios.isCancel(error)) return;
}

// ❌ 避免：直接判断 AbortError（axios 包装后 name 不再是 'AbortError'）
catch (error) {
  if (error.name === 'AbortError') return;
}

// ✅ 也可以：判断 axios 的错误码
catch (error) {
  if (error.code === 'ERR_CANCELED') return;
}
```

---

## 总结

| 问题       | 根因               | 方案                    | 关键 API                                 |
| ---------- | ------------------ | ----------------------- | ---------------------------------------- |
| 竞态条件   | 请求返回顺序不可控 | 取消过期请求 / 序号标记 | `AbortController` + `axios.isCancel` |
| 并发失控   | 同时发出过多请求   | 并发池排队执行          | `Promise` + 队列                       |
| 卸载后更新 | 组件已销毁仍回调   | useEffect 清理取消      | `useEffect` return + `signal`        |

这三个问题有一个共同的解法核心——`AbortController`。axios 从 v0.22.0 起原生支持通过 `signal` 选项接入 `AbortController`，早期的 `CancelToken` API 已被官方标记为废弃。理解并熟练运用 `AbortController`，就掌握了前端异步控制的基本功。

对于大型项目，推荐在 axios 实例的拦截器中统一处理取消逻辑，避免在每个请求的 `catch` 中重复编写 `axios.isCancel` 判断。再配合 React Query 或 SWR（它们内置了竞态和取消的处理），你的异步代码会变得既健壮又简洁。
