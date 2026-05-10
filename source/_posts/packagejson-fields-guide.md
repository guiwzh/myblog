---
title: package.json 字段指南：库、应用与 CLI 的差异化写法
date: 2026-05-11 11:00:00
tags:
  - 前端
  - Node.js
  - npm
  - package.json
categories:
  - 前端
description: 按字段类别梳理 package.json 的每一项配置，重点对比工具库、前端应用、CLI 三类项目的差异化写法，附 exports 多入口、overrides 版本覆盖、node_modules/.bin 机制等深度解析。
cover: https://picsum.photos/seed/packagejson-fields-guide/800/450
---

`package.json` 是 Node.js 项目的核心配置文件，它既是 npm/yarn/pnpm 等包管理器的"清单"，也是项目元信息的载体。本文按字段类别详细介绍每个常见字段的含义、作用，并区分**工具库（library）**、**前端应用（application）**、**CLI 工具**这三类项目的不同写法。

> 📌 文中代码示例的依赖版本号（如 React、ESLint、Vite 的具体版本）仅作演示，实际项目请使用当前最新稳定版。

---

## 目录

- [一、基础元信息字段](#一基础元信息字段)
- [二、入口与导出字段](#二入口与导出字段)
- [三、依赖管理字段](#三依赖管理字段)
- [四、脚本与执行字段](#四脚本与执行字段)
- [五、发布与包行为字段](#五发布与包行为字段)
- [六、工作区与 Monorepo 字段](#六工作区与-monorepo-字段)
- [七、内嵌的工具配置字段](#七内嵌的工具配置字段)
- [八、完整示例对比](#八完整示例对比)

---

## 一、基础元信息字段

### `name`

包的名称，**必填**（除非是私有项目）。

- 必须全小写，可包含字母、数字、连字符（`-`）、下划线（`_`）、点（`.`）
- 不能以 `.` 或 `_` 开头
- 不能包含空格或大写字母
- 长度不超过 214 字符
- 作用域包格式：`@scope/name`

```json
{
  "name": "lodash"
}
```

```json
{
  "name": "@vue/reactivity"
}
```

> 对于不发布到 npm 的前端应用，`name` 仅作为项目标识，不会与 npm 上的包冲突。

---

### 作用域包（Scoped Package）详解

#### 什么是作用域包？

作用域包是带命名空间前缀的包，格式为 `@scope/name`，由两部分组成：

- `@scope`：作用域名，必须以 `@` 开头
- `name`：包名，与作用域之间用 `/` 分隔

例子：`@vue/reactivity`、`@types/node`、`@babel/core`、`@tanstack/react-query`、`@nestjs/common`

#### 为什么需要作用域？

1. **命名空间隔离**——npm 是扁平的全局命名空间，热门名字早被占用。`utils`、`http`、`router` 这种通用名都没了，但 `@myorg/utils` 永远是你的。
2. **品牌归属**——一眼看出包的出处。看到 `@vue/*` 就知道是 Vue 官方维护的。
3. **批量管理**——同一作用域下的包可以统一权限、统一发布策略、统一 access token。
4. **防误发**——作用域包默认是私有的，需要显式声明才能公开发布，避免内部包被意外推到公网。

#### 命名规则

- 必须以 `@` 开头，斜杠分隔：`@scope/name`
- 整个字符串（含 `@` 和 `/`）算入 214 字符长度上限
- `scope` 和 `name` 都遵循通用包名规则：小写字母、数字、连字符、下划线、点
- `scope` 必须是 npm 上**已存在**的用户名或组织名，否则发布时报错

#### 安装与导入

安装命令与普通包一致，作用域是名字的一部分：

```bash
npm install @vue/reactivity
pnpm add @types/node -D
yarn add @tanstack/react-query
```

导入时**完整作用域是模块路径的一部分**：

```js
import { ref, computed } from '@vue/reactivity';
import { useQuery } from '@tanstack/react-query';
```

> 类型声明包（如 `@types/node`、`@types/react`）是个例外——它们安装后会**自动注入全局类型**，不需要也不能直接 `import from '@types/xxx'`。例如装了 `@types/node` 后，`Buffer`、`process` 等就成了全局可用的类型。

在磁盘上，作用域对应一层目录：

```
node_modules/
├── @vue/
│   ├── reactivity/
│   ├── runtime-core/
│   └── shared/
├── @types/
│   ├── node/
│   └── react/
└── lodash/          ← 非作用域包直接在 node_modules 根下
```

#### 常见的公共作用域

| 作用域                 | 用途                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `@types/*`           | DefinitelyTyped 维护的 TypeScript 类型声明（如 `@types/node`、`@types/react`） |
| `@babel/*`           | Babel 官方核心包与插件                                                             |
| `@vue/*`             | Vue.js 官方包                                                                      |
| `@angular/*`         | Angular 官方包                                                                     |
| `@nestjs/*`          | NestJS 框架及生态                                                                  |
| `@tanstack/*`        | TanStack 系列（Query、Table、Router 等）                                           |
| `@reduxjs/*`         | Redux 官方现代化工具集（如 `@reduxjs/toolkit`）                                  |
| `@testing-library/*` | Testing Library 系列                                                               |
| `@vitejs/*`          | Vite 官方插件                                                                      |

#### 公开 vs 私有发布（关键差异）

> ⚠️ **作用域包默认是私有的**——这一点经常踩坑。

普通包：

```bash
npm publish        # 默认就是公开发布
```

作用域包：

```bash
npm publish                     # ❌ 报错：私有发布需要付费账号
npm publish --access=public    # ✅ 显式公开发布
```

**推荐做法**：在 `package.json` 中固化发布配置，避免每次手动加参数：

```json
{
  "name": "@myorg/awesome-utils",
  "version": "1.0.0",
  "publishConfig": {
    "access": "public"
  }
}
```

这样团队任何人执行 `npm publish` 都能正确公开发布。

#### 如何拥有自己的作用域

| 场景           | 怎么做                                                                 | 费用   |
| -------------- | ---------------------------------------------------------------------- | ------ |
| 个人作用域     | 注册 npm 账号后自动获得 `@your-username`                             | 免费   |
| 组织（公开包） | 在[npmjs.com/org/create](https://www.npmjs.com/org/create) 创建组织       | 免费   |
| 组织（私有包） | 同上，但需要订阅付费方案                                               | 付费   |
| 企业内部作用域 | 自建私有 registry（Verdaccio / Nexus / Artifactory / GitHub Packages） | 自托管 |

企业自建场景下，常见做法是**作用域路由**——通过 `.npmrc` 把特定作用域指向内部仓库：

```ini
# .npmrc
@mycompany:registry=https://npm.mycompany.com
//npm.mycompany.com/:_authToken=${NPM_TOKEN}
```

这样：

- `@mycompany/*` 走内部仓库
- 其他包仍走公共 npm registry
- 不同作用域可以指向不同 registry，互不影响

#### 作用域 vs 非作用域：选择指南

| 场景                                 | 建议                                                         |
| ------------------------------------ | ------------------------------------------------------------ |
| 个人开源小工具                       | 名字够独特就用非作用域；想省心或预防被抢可用 `@yourname/*` |
| 组织/公司开源项目                    | 一律用 `@orgname/*`，统一品牌                              |
| 多个相关包构成的生态（框架、工具链） | 必须用同一作用域，便于识别和管理                             |
| 公司内部业务包                       | `@company/*` + 私有 registry                               |
| Fork 别人的包修改后重发              | 改成 `@yourname/*` 避免与原包冲突                          |

#### 一个常见误解

> "作用域包必须用作用域 registry。"

**不对**。作用域只是包名格式，与 registry 解耦。`@myorg/foo` 既可以发到公共 npm，也可以发到私有 registry，取决于发布时的配置。`.npmrc` 里的作用域路由是**可选的便利特性**，不是强制要求。

---

### `version`

包的版本号，**必填**，遵循 [SemVer 语义化版本](https://semver.org/lang/zh-CN/) 规范：`MAJOR.MINOR.PATCH`。

- `MAJOR`（主版本）：不兼容的 API 修改
- `MINOR`（次版本）：向下兼容的功能新增
- `PATCH`（修订号）：向下兼容的 bug 修复
- 预发布标识：`1.0.0-alpha.1`、`2.0.0-beta.3`、`3.0.0-rc.1`

```json
{
  "version": "1.4.2"
}
```

---

### `description`

简短描述，会显示在 `npm search` 结果里，影响搜索权重。

```json
{
  "description": "A modern utility library delivering modularity, performance & extras."
}
```

---

### `keywords`

关键词数组，提升 npm 搜索的可发现性。

```json
{
  "keywords": ["utility", "functional", "lodash", "fp"]
}
```

> 对于私有的前端应用，这个字段意义不大，可省略。

---

### `author` 与 `contributors`

作者与贡献者信息，支持字符串或对象两种格式。

```json
{
  "author": "John Doe <john@example.com> (https://johndoe.com)",
  "contributors": [
    {
      "name": "Alice",
      "email": "alice@example.com",
      "url": "https://alice.dev"
    }
  ]
}
```

---

### `license`

开源协议标识，使用 [SPDX 标识符](https://spdx.org/licenses/)。

```json
{
  "license": "MIT"
}
```

私有项目可写：

```json
{
  "license": "UNLICENSED"
}
```

---

### `homepage` / `repository` / `bugs`

项目的主页、源码仓库、问题反馈地址。

```json
{
  "homepage": "https://github.com/user/repo#readme",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/user/repo.git"
  },
  "bugs": {
    "url": "https://github.com/user/repo/issues",
    "email": "bugs@example.com"
  }
}
```

monorepo 子包可指定子目录：

```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/vuejs/core.git",
    "directory": "packages/reactivity"
  }
}
```

---

## 二、入口与导出字段

这是**工具库作者最关注**的一组字段，决定了使用者 `import`/`require` 你的包时拿到什么文件。

### `main`

CommonJS 环境的默认入口（Node.js 传统入口）。

```json
{
  "main": "./dist/index.cjs.js"
}
```

---

### `module`

ESM 入口的事实标准——告诉打包工具（webpack、rollup、vite）"这个文件是 ES Module 形态"，从而让打包工具能进行 tree-shaking（tree-shaking 本身依赖 ESM 的静态结构，不是这个字段的功能）。**注意：这是社区约定，并非 Node.js 官方规范**，因此 Node.js 自身不读取它。

```json
{
  "main": "./dist/index.cjs.js",
  "module": "./dist/index.esm.js"
}
```

---

### `types` / `typings`

TypeScript 类型声明文件入口，两者等价，**推荐用 `types`**。

```json
{
  "types": "./dist/index.d.ts"
}
```

---

### `exports` （现代推荐方式）

Node.js 12.7+ 引入的现代入口配置。它**取代** `main` / `module` / `browser` 成为更强大、更精准的入口声明方式，是当前发布包的事实标准。

#### 它解决了什么问题？

在 `exports` 出现之前，包入口存在多个痛点：

1. **单一入口** —— `main` 只能指向一个文件，无法同时为 CJS / ESM / TypeScript 提供不同入口。
2. **没有封装性** —— 用户可以 `require('lib/src/internal/private.js')` 访问任何内部文件，作者无法控制公共 API 边界。
3. **多入口靠目录约定** —— 想提供 `lib/utils` 这种子入口，必须真的建一个 `utils/` 目录并放 `package.json`，目录结构被绑死。
4. **CJS/ESM 互操作混乱** —— 同时支持两种模块系统时，靠 `main` + `module` + `browser` 拼凑，工具链各家解析规则不一。

`exports` 一次性解决了这些问题：**多入口、条件导出、强制封装**。

#### 三种基本形态

##### 1. 字符串简写（单入口）

完全等价于 `main`，但同时启用了封装效果：

```json
{
  "exports": "./dist/index.js"
}
```

设置后，`require('mypkg')` 能拿到 `index.js`，但 `require('mypkg/internal.js')` 会**直接报错**（即使文件存在）。

##### 2. 子路径映射（多入口）

通过对象声明多个入口点：

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./utils": "./dist/utils.js",
    "./hooks": "./dist/hooks.js"
  }
}
```

使用方：

```js
import main from 'mypkg';            // → dist/index.js
import utils from 'mypkg/utils';     // → dist/utils.js
import hooks from 'mypkg/hooks';     // → dist/hooks.js
import x from 'mypkg/secret';        // ❌ 未在 exports 中，报错
```

> `"."` 代表包本身的根入口，必须显式声明，不会自动从 `main` fallback。

##### 3. 条件导出（环境分流）

**最强大的能力**——根据使用环境（CJS/ESM、Node/浏览器、开发/生产、TypeScript）解析不同文件：

```json
{
  "exports": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.mjs",
    "require": "./dist/index.cjs"
  }
}
```

#### 条件导出（Conditional Exports）详解

##### 完整的条件键列表

| 条件键          | 触发场景                                    | 来源     |
| --------------- | ------------------------------------------- | -------- |
| `types`       | TypeScript 类型解析                         | TS       |
| `import`      | `import` / 动态 `import()` / ESM 上下文 | Node.js  |
| `require`     | `require()` / CJS 上下文                  | Node.js  |
| `node`        | 运行在 Node.js 中                           | Node.js  |
| `node-addons` | Node.js 原生模块场景                        | Node.js  |
| `browser`     | 打包工具识别为浏览器目标                    | 社区约定 |
| `deno`        | Deno 运行时                                 | Deno     |
| `bun`         | Bun 运行时                                  | Bun      |
| `worker`      | Web Worker 环境                             | 社区约定 |
| `development` | 开发模式（部分打包工具）                    | 社区约定 |
| `production`  | 生产模式（部分打包工具）                    | 社区约定 |
| `default`     | 兜底——前面都不匹配时使用                  | Node.js  |

> 自定义条件也合法（如 `"my-bundler"`），需要消费方明确启用。

##### 顺序至关重要：First Match Wins

条件按**对象字面量从上到下**的顺序匹配，**第一个命中**的就被使用，后面全部忽略。这有两条铁律：

**铁律 1：`types` 必须放最前面**

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",   // ✅ 必须第一
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    }
  }
}
```

为什么？TypeScript 解析时也会按顺序匹配。如果 `import` 在前命中了 `.mjs`，TS 就拿不到类型声明，使用方会丢失类型提示。

**铁律 2：`default` 必须放最后**

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "node": "./dist/node.js",
      "browser": "./dist/browser.js",
      "default": "./dist/index.js"   // ✅ 兜底，必须最后
    }
  }
}
```

`default` 是兜底分支，放前面会让后续条件永远匹配不到。

##### 嵌套条件

条件可以嵌套，组合环境维度：

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "node": {
        "import": "./dist/node.mjs",
        "require": "./dist/node.cjs"
      },
      "browser": {
        "import": "./dist/browser.mjs",
        "require": "./dist/browser.cjs"
      },
      "default": "./dist/index.js"
    }
  }
}
```

读法：

- 在 Node + ESM 环境 → `node.mjs`
- 在 Node + CJS 环境 → `node.cjs`
- 在浏览器 + ESM 环境 → `browser.mjs`
- 在浏览器 + CJS 环境 → `browser.cjs`
- 都不是 → `index.js`

#### 子路径模式（Subpath Patterns）

Node.js 16+ 支持用 `*` 通配符做模式映射，避免一个个手写子入口：

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./features/*": "./dist/features/*.js",
    "./features/*.js": "./dist/features/*.js"
  }
}
```

使用方：

```js
import a from 'mypkg/features/auth';     // → dist/features/auth.js
import b from 'mypkg/features/payment';  // → dist/features/payment.js
```

> **注意**：`*` 不是正则的星号——它匹配任意字符串（包括 `/`），但不会做路径遍历检查。要谨慎设计模式，避免把不该暴露的文件路径开放出去。

模式也可以与条件结合：

```json
{
  "exports": {
    "./features/*": {
      "types": "./dist/features/*.d.ts",
      "import": "./dist/features/*.mjs",
      "require": "./dist/features/*.cjs"
    }
  }
}
```

#### 封装性（Encapsulation）

**这是 `exports` 最容易被忽略的副作用**——一旦使用 `exports`，**没有列出的路径就完全不可访问**，即使文件物理存在。

对比：

```json
// 旧方式（main）
{
  "main": "./dist/index.js"
}
```

```js
require('lib');                       // ✅ 解析到 dist/index.js
require('lib/dist/utils.js');         // ✅ 也能拿到（无封装）
require('lib/src/internal/db.js');    // ✅ 还能拿到（完全暴露）
```

```json
// 新方式（exports）
{
  "exports": {
    ".": "./dist/index.js",
    "./utils": "./dist/utils.js"
  }
}
```

```js
require('lib');                       // ✅
require('lib/utils');                 // ✅
require('lib/dist/utils.js');         // ❌ ERR_PACKAGE_PATH_NOT_EXPORTED
require('lib/src/internal/db.js');    // ❌ 报错
```

这是好事——你能控制公共 API 边界，重构内部实现不会破坏使用者的代码。

##### 必须显式开放的路径

很多工具会读取 `package.json` 自身或其他元文件，需要显式暴露：

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./package.json": "./package.json"
  }
}
```

否则 `require('mypkg/package.json')` 会失败，影响版本检测、`browserslist` 读取等。

#### 完整模板：双模 + 多入口 + TypeScript

工具库最常见的"全配齐"形态：

```json
{
  "name": "@myorg/awesome",
  "version": "1.0.0",
  "type": "module",

  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",

  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    },
    "./utils": {
      "types": "./dist/utils.d.ts",
      "import": "./dist/utils.mjs",
      "require": "./dist/utils.cjs"
    },
    "./hooks": {
      "types": "./dist/hooks.d.ts",
      "import": "./dist/hooks.mjs",
      "require": "./dist/hooks.cjs"
    },
    "./styles.css": "./dist/styles.css",
    "./package.json": "./package.json"
  }
}
```

- 顶层 `main` / `module` / `types` 是**降级兼容**，给老旧工具链用
- `exports` 是给现代工具链（Node.js、Vite、Webpack 5+、TS 4.7+）用的精准声明
- CSS 文件可以直接以字符串形式映射，不需要条件
- `package.json` 一定要开放

#### 实战模式集合

##### 模式 A：仅 ESM 包（现代纯净路线）

```json
{
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  }
}
```

适合明确不再支持 CJS 的新包。`default` 在这里就是 ESM。

##### 模式 B：浏览器/Node 双产物

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "browser": "./dist/index.browser.js",
      "node": "./dist/index.node.js",
      "default": "./dist/index.js"
    }
  }
}
```

##### 模式 C：开发/生产分流（带断言、调试日志的开发版）

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "development": "./dist/index.dev.js",
      "production": "./dist/index.prod.js",
      "default": "./dist/index.js"
    }
  }
}
```

> React 内部就是用这种模式，但需要打包工具支持（webpack/vite 都支持，Node.js 原生不识别）。

##### 模式 D：Server Components / Edge Runtime

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "react-server": "./dist/index.rsc.js",
      "edge-light": "./dist/index.edge.js",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    }
  }
}
```

##### 模式 E：限制内部目录、仅暴露公共 API

```json
{
  "exports": {
    ".": "./dist/public.js",
    "./plugins/*": "./dist/plugins/*.js"
  }
}
```

`./src/internal/*` 完全隔离，无法被外部访问。

#### 常见坑点

##### 1. `types` 不在最前面，类型丢失

❌ 错误：

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "types": "./dist/index.d.ts"
    }
  }
}
```

TypeScript 在 ESM 解析时先匹配到 `import` → `.mjs`，永远碰不到 `types`，使用方拿不到类型。

##### 2. 忘记开放 `./package.json`

很多工具（包括 `read-pkg`、`vite`、`browserslist`）会读取依赖的 `package.json`。不开放会报 `ERR_PACKAGE_PATH_NOT_EXPORTED`。

##### 3. CJS 文件用 `import` 条件，ESM 文件用 `require` 条件

条件名描述的是**消费方的解析方式**，不是产物本身的格式：

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.mjs",   // ← 当被 import 时，给你 .mjs
      "require": "./dist/index.cjs"   // ← 当被 require 时，给你 .cjs
    }
  }
}
```

文件后缀（或 `package.json` 的 `type`）决定文件本身是 ESM 还是 CJS，与条件键无关。**不要把 ESM 文件给 require 条件**——会引发 `ERR_REQUIRE_ESM`。

##### 4. `exports` 设了之后 `main` 不再生效

只在显式启用 `exports` 时生效。一旦写了 `exports`，Node.js 12.7+ 与现代打包工具会**完全忽略** `main` / `module` / `browser`。

> 兼容写法：保留 `main` / `module` / `types` 作为旧工具的 fallback，新工具走 `exports`。两套并存不会冲突。

##### 5. 老版本 TypeScript 不读 `exports`

TypeScript **4.7 以下**根本不识别 `exports.types`，依然只看顶层 `types`。所以**顶层 `types` 字段不能省**，否则老 TS 用户拿不到类型。

TypeScript 4.7+ 需要在 `tsconfig.json` 设置：

```json
{
  "compilerOptions": {
    "moduleResolution": "bundler"   // 或 "node16" / "nodenext"
  }
}
```

`moduleResolution: "node"`（旧默认值）**完全不会读 `exports`**。

##### 6. `*` 模式陷阱

```json
{
  "exports": {
    "./*": "./src/*"
  }
}
```

这相当于把整个 `src/` 暴露出去，封装性归零。要避免这种"开门揖盗"的写法。

#### 工具链支持现状（截至 2026 年）

| 工具                  | 支持情况                                                            |
| --------------------- | ------------------------------------------------------------------- |
| Node.js 12.7+         | ✅ 原生支持                                                         |
| Node.js 12.16+        | ✅ 支持子路径模式                                                   |
| Webpack 5+            | ✅ 完整支持                                                         |
| Vite / Rollup         | ✅ 完整支持                                                         |
| esbuild               | ✅ 完整支持                                                         |
| TypeScript 4.7+       | ✅ 需配 `moduleResolution: bundler/node16/nodenext`               |
| TypeScript 4.6 及以下 | ❌ 完全不识别                                                       |
| Jest 28+              | ⚠️ 部分支持，需 `testEnvironmentOptions.customExportConditions` |
| Webpack 4             | ❌ 不支持                                                           |

#### 调试技巧：验证 exports 配置是否正确

发布前用以下命令逐一验证每个入口能否被正确解析：

```bash
# 模拟 ESM 解析
node --input-type=module -e "import x from 'mypkg'; console.log(x)"
node --input-type=module -e "import x from 'mypkg/utils'; console.log(x)"

# 模拟 CJS 解析
node -e "console.log(require('mypkg'))"
node -e "console.log(require('mypkg/utils'))"
```

或用专业工具：

- [`@arethetypeswrong/cli`](https://arethetypeswrong.github.io/) —— 最权威的 `exports` + 类型配置检查器，强烈推荐
- [`publint`](https://publint.dev/) —— 检查发布相关配置的整体健康度

```bash
npx @arethetypeswrong/cli --pack
npx publint
```

这两个工具能发现 95% 的 `exports` 配置错误，发布前必跑。

---

### `browser`

为浏览器环境提供的替代入口，可重定向某些 Node.js 模块。

```json
{
  "main": "./dist/index.node.js",
  "browser": "./dist/index.browser.js"
}
```

或对象形式做模块替换：

```json
{
  "browser": {
    "fs": false,
    "./src/server.js": "./src/browser-shim.js"
  }
}
```

---

### `bin`

声明可执行命令，安装时会在 `node_modules/.bin/` 下创建对应的命令入口（Linux/macOS 是符号链接，Windows 是包装脚本，详见下一节）。CLI 工具必备。

单命令：

```json
{
  "name": "my-cli",
  "bin": "./bin/cli.js"
}
```

多命令：

```json
{
  "bin": {
    "eslint": "./bin/eslint.js",
    "eslint-fix": "./bin/eslint-fix.js"
  }
}
```

> 入口文件首行需添加 `#!/usr/bin/env node`。

---

### 深入：`node_modules/.bin/` 是怎么工作的

`bin` 字段只是"声明"，真正让命令能被调用的是 npm 在安装时生成的 `node_modules/.bin/` 目录。理解这套机制能解释很多日常困惑：为什么本地装的工具能直接用？为什么 Windows 上每个命令有三个文件？为什么 `npm run build` 能跑，终端直接敲 `tsup` 却不行？

#### 这个目录是什么

`node_modules/.bin/` 由 npm（或 pnpm/yarn）在 `npm install` 时**自动生成**，集中存放所有依赖暴露的 CLI 命令的可执行入口。它的作用类似于系统的 `PATH` 目录——把第三方包的可执行命令汇聚到一处，让 `npm scripts` 和 `npx` 不必写完整路径就能调用。

**它在不同操作系统上的实现机制完全不同**，这是理解后续内容的关键：

| 操作系统      | `.bin/tsup` 是什么                                                              | 文件数量       |
| ------------- | --------------------------------------------------------------------------------- | -------------- |
| Linux / macOS | **符号链接**（symlink），直接指向 `node_modules/tsup/dist/cli-default.js` | 1 个（无后缀） |
| Windows       | **三个垫片脚本**（shim）：分别适配 cmd / PowerShell / Git Bash              | 3 个           |

##### Linux / macOS 上的实际形态

```
node_modules/.bin/
├── tsup -> ../tsup/dist/cli-default.js   # 符号链接
├── tsc  -> ../typescript/bin/tsc          # 符号链接
└── eslint -> ../eslint/bin/eslint.js      # 符号链接
```

执行 `tsup` 时，shell 通过符号链接找到真实 JS 文件，再靠该文件首行的 `#!/usr/bin/env node` shebang 让系统用 node 执行它。**整个过程不需要任何包装脚本**。

##### Windows 上的实际形态

Windows 不依赖 shebang，而且对符号链接支持历史上较弱，所以 npm 改用"垫片脚本"方案——为每个命令生成三个文件：

```
node_modules\.bin\
├── tsup           # 无后缀：给 Git Bash / MSYS / Cygwin 用的 shell 脚本
├── tsup.cmd       # 给 cmd.exe 用的批处理
├── tsup.ps1       # 给 PowerShell 用的脚本
├── tsc
├── tsc.cmd
├── tsc.ps1
└── ...
```

三个文件做的事一样：找到 node、用 node 执行真实的入口 JS、透传参数和退出码。

> 下面的"三种垫片脚本逐字详解"展示的就是 **Windows 上**的三个文件内容。Linux/macOS 用户在自己的 `.bin/` 里看不到这些脚本，只会看到符号链接。
>
> pnpm 的实现略有不同：在所有平台都用垫片脚本（不用 symlink），是为了配合它的 hard-link 隔离机制。具体细节本文不展开。

#### 这些文件是怎么生成的

完全由依赖包自己 `package.json` 的 `bin` 字段决定。以 `tsup` 为例，它的 `package.json` 里写：

```json
{
  "name": "tsup",
  "bin": {
    "tsup": "dist/cli-default.js",
    "tsup-node": "dist/cli-node.js"
  }
}
```

`npm install tsup` 时 npm 看到这个声明：

- **Linux/macOS**：在 `.bin/` 下创建符号链接 `tsup -> ../tsup/dist/cli-default.js`
- **Windows**：在 `.bin/` 下生成 `tsup` / `tsup.cmd` / `tsup.ps1` 三个垫片，全部在内部指向 `node_modules/tsup/dist/cli-default.js`

`tsup-node` 同理，独立生成。

#### 三种垫片脚本逐字详解（Windows 平台）

> 以下三段代码是 **Windows** 上 `.bin/` 目录里的真实文件内容。Linux/macOS 上只有一个符号链接，没有这些包装层。

##### Shell 垫片（`tsup`，给 Windows 上的 Git Bash / MSYS / Cygwin 使用）

```sh
#!/bin/sh
basedir=$(dirname "$(echo "$0" | sed -e 's,\\,/,g')")

case `uname` in
    *CYGWIN*|*MINGW*|*MSYS*)
        if command -v cygpath > /dev/null 2>&1; then
            basedir=`cygpath -w "$basedir"`
        fi
    ;;
esac

if [ -x "$basedir/node" ]; then
  exec "$basedir/node"  "$basedir/../tsup/dist/cli-default.js" "$@"
else
  exec node  "$basedir/../tsup/dist/cli-default.js" "$@"
fi
```

| 代码片段                                                  | 含义                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| `#!/bin/sh`                                             | Shebang，告诉系统用 `sh` 解释执行                                |
| `basedir=$(dirname ...)`                                | 取脚本自身所在目录（即 `.bin/`）                                 |
| `<code>`case &#96;uname&#96; ... esac `</code>`       | 检测 Cygwin/MinGW/MSYS 环境，必要时转换路径格式                    |
| `if [ -x "$basedir/node" ]`                             | 优先用 `.bin/` 同级的 `node`（如果存在）                       |
| `exec node "$basedir/../tsup/dist/cli-default.js" "$@"` | **核心**：用 node 启动 tsup 的入口 JS，`"$@"` 透传所有参数 |

##### CMD 垫片（`tsup.cmd`，Windows cmd.exe）

```bat
@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\node.exe" (
  SET "_prog=%dp0%\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" "%dp0%\..\tsup\dist\cli-default.js" %*
```

| 代码片段                                             | 含义                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| `@ECHO off`                                        | 关闭命令回显                                                          |
| `SET dp0=%~dp0`                                    | 取脚本所在目录                                                        |
| `IF EXIST "%dp0%\node.exe"`                        | 优先用本地 `node.exe`                                               |
| `SET PATHEXT=%PATHEXT:;.JS;=;%`                    | 从 PATHEXT 移除 `.JS`，防止 Windows 把 `.js` 当成可独立运行的文件 |
| `"%_prog%" "%dp0%\..\tsup\dist\cli-default.js" %*` | **核心**：用 node 执行 tsup 入口，`%*` 透传参数               |

##### PowerShell 垫片（`tsup.ps1`，Windows PowerShell）

```powershell
#!/usr/bin/env pwsh
$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent

$exe=""
if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {
  $exe=".exe"
}
$ret=0
if (Test-Path "$basedir/node$exe") {
  if ($MyInvocation.ExpectingInput) {
    $input | & "$basedir/node$exe"  "$basedir/../tsup/dist/cli-default.js" $args
  } else {
    & "$basedir/node$exe"  "$basedir/../tsup/dist/cli-default.js" $args
  }
  $ret=$LASTEXITCODE
} else {
  if ($MyInvocation.ExpectingInput) {
    $input | & "node$exe"  "$basedir/../tsup/dist/cli-default.js" $args
  } else {
    & "node$exe"  "$basedir/../tsup/dist/cli-default.js" $args
  }
  $ret=$LASTEXITCODE
}
exit $ret
```

| 代码片段                                                                                                     | 含义                                                |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `$basedir=Split-Path ...`                                                                                  | 取脚本所在目录                                      |
| `if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows)`                                                  | 判断平台，决定是否加 `.exe` 后缀                  |
| `$MyInvocation.ExpectingInput`                                                                             | 检测是否有管道输入（支持把文件内容用管道喂给 tsup） |
| `& "node$exe" "$basedir/../tsup/dist/cli-default.js" $args` | **核心**：执行入口，`$args` 透传参数 |                                                     |
| `exit $ret`                                                                                                | 把子进程退出码透传出去（CI 判断成功失败的关键）     |

> 三个脚本干的事完全一样：**找到 node，用 node 执行真实的入口 JS，把参数和退出码透明传递**。区别仅在于宿主 shell 的语法。

#### 垫片最终指向哪里

不管走哪个垫片，最终都跑到同一个文件：

```
node_modules/tsup/dist/cli-default.js
```

```js
#!/usr/bin/env node
"use strict";

var _chunkDI5BO6XEjs = require('./chunk-DI5BO6XE.js');
require('./chunk-PEEXUWMS.js');

var _chunkJZ25TPTYjs = require('./chunk-JZ25TPTY.js');
require('./chunk-TWFEYLU4.js');

// src/cli-default.ts
_chunkDI5BO6XEjs.main.call(void 0, ).catch(_chunkJZ25TPTYjs.handleError);
```

这是 `src/cli-default.ts` 经 esbuild 编译 + 代码分割后的产物。逻辑很简单：调用 `main()` 启动 tsup 流程，出错交给 `handleError`。文件首行的 `#!/usr/bin/env node` 让它在 Linux/macOS 下也可以直接 `chmod +x` 后执行。

#### 完整调用链路

当你写 `"build": "tsup src/index.ts"` 并执行 `npm run build`：

```
npm run build
  │
  ▼
npm 把 node_modules/.bin/ 加入子进程的 PATH
  │
  ▼
shell 在 PATH 中找到 tsup：
  ┌─ Linux/macOS：通过符号链接直达 cli-default.js（首行 shebang 触发 node 执行）
  └─ Windows：根据当前 shell 选择垫片
      - cmd.exe     → tsup.cmd
      - PowerShell  → tsup.ps1
      - Git Bash    → tsup（无后缀的 sh 脚本）
  │
  ▼
最终都执行：node node_modules/tsup/dist/cli-default.js src/index.ts
  │
  ▼
cli-default.js 中的 main():
  - 解析命令行参数（src/index.ts、--format、--dts 等）
  - 读取 tsup.config.ts（如有）
  - 调用 esbuild 实际打包
  │
  ▼
输出 dist/ 构建产物，进程退出码原样返回给 npm
```

#### 三种等价写法

理解了上面的机制，下面这三条命令的等价性就显而易见：

```bash
npx tsup src/index.ts                                       # 由 npx 临时把 .bin/ 加入 PATH
./node_modules/.bin/tsup src/index.ts                       # 直接走垫片
node ./node_modules/tsup/dist/cli-default.js src/index.ts   # 跳过垫片直接 node
```

`npx` 的作用本质就是**把 `.bin/` 临时加进 PATH 后调用一次**——所以它和 npm scripts 里直接写 `tsup` 在执行机制上是同一回事，只不过 npm scripts 是隐式地做了 PATH 注入。

#### 几个常见疑问

**Q：为什么 Windows 上每个命令有三个文件、Linux/macOS 上只有一个？**

Linux/macOS 系统执行文件靠首行的 shebang（`#!/usr/bin/env node`），所以 npm 直接创建一个**符号链接**指向真实 JS 即可，无需包装层。Windows 不识别 shebang，且历史上 symlink 支持很弱，因此 npm 退而求其次：为 cmd.exe（`.cmd`）、PowerShell（`.ps1`）、Git Bash（无后缀）分别生成三种语法的包装脚本。

**Q：可以删掉这些文件吗？**

可以，但下次 `npm install` / `npm rebuild` 会重新生成。如果手动删了之后命令找不到了，重装依赖即可。

**Q：`npx` 和 `npm run` 走的是不是同一套机制？**

是同一套机制。两者都依赖 `.bin/` 目录里的链接/垫片，区别只在于：

- `npm run xxx` —— 必须在 `scripts` 里预定义
- `npx xxx` —— 直接根据命令名查 `.bin/`，没找到还会从 npm registry 临时下载

**Q：本地安装和全局安装的区别？**

| 安装方式               | 链接位置                                                                                              | 调用方式                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------- |
| 本地 `npm i tsup`    | `项目/node_modules/.bin/`                                                                           | 项目内 `npm run` / `npx` |
| 全局 `npm i -g tsup` | 系统全局目录（POSIX 通常 `/usr/local/bin/`，Windows 通常 `%APPDATA%\npm\` 或 nvm/fnm 自定义路径） | 任何路径直接 `tsup`        |

全局目录已经在系统 PATH 里，所以全局命令在哪都能用。本地安装只在项目里有效——这是有意为之，保证团队所有人用同一版本工具。

**Q：为什么终端里直接敲 `tsup` 提示找不到，但 `npm run build` 里写 `tsup` 就能跑？**

终端的 PATH 默认不包含 `node_modules/.bin/`。`npm run` 会**临时**把这个目录加到子进程的 PATH 最前面，命令结束就消失，不影响你的终端。想在终端直接调用本地工具，用 `npx tsup` 或者 `pnpm exec tsup` / `yarn tsup`。

**Q：为什么 `bin` 字段必须配合 `#!/usr/bin/env node`？**

Linux/macOS 下垫片是符号链接，直接指向你 `bin` 字段里的目标 JS 文件。系统执行这个文件时需要 shebang 告诉它"用 node 跑"。Windows 不靠 shebang（用包装脚本），所以即便不写也能在 Windows 上工作——但 Linux/macOS 用户会拿到 `Exec format error`。所以**必须写**。

---

### `files`

发布到 npm 时**白名单**包含的文件/目录。结合 `.npmignore` 使用，但 `files` 优先级更高。

```json
{
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ]
}
```

> `package.json`、`README`、`LICENSE` 总是被自动包含；`node_modules`、`.git` 总是被自动排除。

---

## 三、依赖管理字段

### `dependencies`

**生产依赖**——运行时必需的包。

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "axios": "~1.6.0",
    "lodash-es": "4.17.21"
  }
}
```

**版本范围语法速查**：

| 符号          | 含义             | 示例                | 匹配范围           |
| ------------- | ---------------- | ------------------- | ------------------ |
| `^`         | 兼容次版本和补丁 | `^1.2.3`          | `>=1.2.3 <2.0.0` |
| `~`         | 仅兼容补丁       | `~1.2.3`          | `>=1.2.3 <1.3.0` |
| 精确          | 锁死版本         | `1.2.3`           | `=1.2.3`         |
| `>=`        | 大于等于         | `>=1.2.3`         | 任何 ≥1.2.3       |
| `*`         | 任意版本         | `*`               | 全部               |
| `\|\|`        | 或               | `^1 \|\| ^2`        | v1 或 v2           |
| `git`       | git 仓库         | `git+https://...` | 指定仓库           |
| `file`      | 本地路径         | `file:../shared`  | 本地包             |
| `workspace` | monorepo 引用    | `workspace:*`     | 工作区内           |

---

### `devDependencies`

**开发依赖**——构建、测试、lint 等开发期才用的包，发布到 npm 时使用方不会安装。

```json
{
  "devDependencies": {
    "typescript": "^5.3.0",
    "vitest": "^1.1.0",
    "eslint": "^8.56.0",
    "@types/node": "^20.10.0"
  }
}
```

---

### `peerDependencies`

**对等依赖**——声明"我需要使用方的环境里有这个包"，避免重复安装/版本冲突。

**典型场景**：插件、组件库声明对宿主框架的依赖。

```json
{
  "name": "react-router-dom",
  "peerDependencies": {
    "react": ">=16.8.0",
    "react-dom": ">=16.8.0"
  }
}
```

> npm 7+ 会自动安装 peer deps；旧版本和某些 yarn 版本不会，需用户手动安装。

---

### `peerDependenciesMeta`

标注 peer 依赖的额外信息，最常见的是声明**可选**的对等依赖。

```json
{
  "peerDependencies": {
    "react": ">=16.8.0",
    "typescript": ">=4.0.0"
  },
  "peerDependenciesMeta": {
    "typescript": {
      "optional": true
    }
  }
}
```

---

### `optionalDependencies`

可选依赖——安装失败也不会导致整个 `npm install` 失败。常用于跨平台二进制依赖（如 `fsevents` 仅 macOS 用）。

```json
{
  "optionalDependencies": {
    "fsevents": "^2.3.3"
  }
}
```

代码中需要 `try/catch` 处理 `require`：

```js
let fsevents;
try {
  fsevents = require('fsevents');
} catch {
  // 不可用时降级
}
```

---

### `bundledDependencies` / `bundleDependencies`

发布时**一同打包**进 tarball 的依赖（不通过 npm 注册表下载）。罕见，多用于私有分发。

```json
{
  "bundledDependencies": ["my-internal-utils"]
}
```

---

### `overrides` (npm) / `resolutions` (yarn) / `pnpm.overrides`

强制干预依赖树中**任意层级**包的版本，是处理传递依赖问题的"核武器"。

#### 它解决了什么问题？

现代项目的依赖树是分层的：

```
your-app
├── package-a@2.0.0
│   └── lodash@4.17.15   ← 有已知 CVE 漏洞
├── package-b@1.5.0
│   └── lodash@4.17.18   ← 也有漏洞
└── lodash@4.17.21        ← 你直接装的，没问题
```

你直接 `npm install lodash@4.17.21` 只能管到第一层，**`package-a` 和 `package-b` 内部用的还是旧版本**。这就是传递依赖（transitive dependency）问题。

传统解决路径有三条，每条都很糟：

1. 等上游 `package-a` / `package-b` 发版升级 lodash —— 不可控
2. fork 它们改完自己发包 —— 维护成本爆炸
3. 删了不用 —— 不现实

`overrides` 提供第四条路：**直接告诉包管理器"不管谁要 lodash，都给它 4.17.21"**。

#### 三大包管理器的语法对比

| 包管理器               | 字段               | 位置                | 引入版本   |
| ---------------------- | ------------------ | ------------------- | ---------- |
| npm                    | `overrides`      | 顶层                | npm 8.3+   |
| yarn (Classic / Berry) | `resolutions`    | 顶层                | yarn 1.0+  |
| pnpm                   | `pnpm.overrides` | `pnpm` 命名空间下 | pnpm 5.10+ |

##### npm

```json
{
  "overrides": {
    "lodash": "4.17.21"
  }
}
```

##### yarn

```json
{
  "resolutions": {
    "lodash": "4.17.21"
  }
}
```

##### pnpm

```json
{
  "pnpm": {
    "overrides": {
      "lodash": "4.17.21"
    }
  }
}
```

> **重要**：这三个字段只在**项目根目录**的 `package.json` 中生效。子包/依赖里写的 `overrides` 会被忽略——这是设计上的安全限制，避免依赖暗中操控你的依赖树。

#### 基础用法：全局替换版本

最常见的场景——把整棵依赖树里所有的 `lodash` 全部钉到 `4.17.21`：

```json
{
  "overrides": {
    "lodash": "4.17.21"
  }
}
```

执行 `npm install` 后查看：

```bash
npm ls lodash
# 所有层级的 lodash 都会显示 4.17.21
```

#### 进阶用法 1：定向覆盖（仅在特定父依赖下生效）

只想替换 `package-a` 内部用的 lodash，其他地方不动：

##### npm 嵌套语法

```json
{
  "overrides": {
    "package-a": {
      "lodash": "4.17.21"
    }
  }
}
```

读法：**仅当 `lodash` 是 `package-a` 的依赖时**，强制使用 `4.17.21`。

##### yarn 路径语法

yarn 用 glob 风格的路径表达：

```json
{
  "resolutions": {
    "package-a/lodash": "4.17.21",
    "**/lodash": "4.17.21"
  }
}
```

- `package-a/lodash` —— 只覆盖 `package-a` 直接依赖的 lodash
- `**/lodash` —— 覆盖任意层级的 lodash（等同于 npm 的顶层 `"lodash"`）

##### pnpm 路径语法

pnpm 也支持 `>` 分隔的精确路径：

```json
{
  "pnpm": {
    "overrides": {
      "package-a>lodash": "4.17.21",
      "package-a>package-b>lodash": "4.17.21"
    }
  }
}
```

#### 进阶用法 2：版本范围限定

只在原依赖范围匹配某个区间时才覆盖（npm 特有，避免误伤）：

```json
{
  "overrides": {
    "lodash@<4.17.21": "4.17.21"
  }
}
```

读法：**只把 `<4.17.21` 范围的 lodash 替换成 `4.17.21`**。已经是新版本的不动。

#### 进阶用法 3：引用已声明的版本（`$` 语法，npm 特有）

避免重复写版本号——`$pkg` 表示"用 `dependencies`/`devDependencies` 里声明的版本"：

```json
{
  "dependencies": {
    "react": "18.2.0"
  },
  "overrides": {
    "react": "$react",
    "react-dom": "$react"
  }
}
```

读法：让整棵树的 `react` 和 `react-dom` 都用根 `dependencies` 里声明的 `18.2.0`。改版本时只需改一处。

> 这是**强制 dedupe**（去重）的标准手法——React 之类的运行时单例库尤其怕多版本共存。

#### 进阶用法 4：替换为完全不同的包

##### npm：用 `npm:` 协议做包别名

```json
{
  "overrides": {
    "lodash": "npm:lodash-es@4.17.21"
  }
}
```

读法：**所有要 `lodash` 的地方，给它 `lodash-es@4.17.21`**。可以用来把整棵树的 CJS 包替换成 ESM 版本（前提是 API 兼容）。

##### 用本地包替换

```json
{
  "overrides": {
    "buggy-pkg": "file:./patches/buggy-pkg-fixed"
  }
}
```

##### 用 git 仓库替换

```json
{
  "overrides": {
    "buggy-pkg": "github:myuser/buggy-pkg-fork#fix-branch"
  }
}
```

适合给别人的 bug 临时打补丁——fork 后改完，指过去用，等上游修复了再撤掉。

#### 实战场景集合

##### 场景 A：紧急修复 CVE 漏洞

`npm audit` 报告 `axios@<1.6.0` 有 SSRF 漏洞，但你的依赖里某个老包还指着 `axios@0.27.2`：

```json
{
  "overrides": {
    "axios": "^1.6.0"
  }
}
```

跑 `npm install` 后再 `npm audit` 验证。

##### 场景 B：强制 React 单例

monorepo 或大型项目里，多个依赖都声明了 `react` 作为 peer，结果装出多份 React 导致 `Invalid Hook Call` 报错：

```json
{
  "dependencies": {
    "react": "18.2.0",
    "react-dom": "18.2.0"
  },
  "overrides": {
    "react": "18.2.0",
    "react-dom": "18.2.0"
  },
  "resolutions": {
    "react": "18.2.0",
    "react-dom": "18.2.0"
  }
}
```

> 也可以用 npm 的 `$pkg` 引用语法（如 `"react": "$react"`）避免重复，但带连字符的包名（如 `react-dom`）在该语法下兼容性不一致，稳妥起见直接写字面版本号。

##### 场景 C：等上游修 bug 时打补丁

`some-lib@2.5.0` 有个崩溃 bug，作者还没修。你 fork 一份修好后：

```json
{
  "overrides": {
    "some-lib": "github:yourname/some-lib#hotfix"
  }
}
```

等官方 `2.5.1` 出来后删掉 override 即可。

> 更优雅的方案是 [`patch-package`](https://github.com/ds300/patch-package) —— 直接用 diff 文件打补丁，不用 fork 仓库。

##### 场景 D：去掉一个不想要的依赖

某个传递依赖引入了 200KB 的 polyfill，你确信运行环境用不上：

```json
{
  "overrides": {
    "core-js": "npm:@empty/empty@1.0.0"
  }
}
```

把它替换成空包。⚠️ 这种操作要确认运行时真的不需要才能用。

##### 场景 E：锁住有兼容性问题的版本

`type-fest@4.x` 有 breaking change，传递依赖里如果引入会编译失败：

```json
{
  "overrides": {
    "type-fest": "^3.0.0"
  }
}
```

#### 关键坑点

##### 1. 只在根 `package.json` 生效

发布到 npm 的库里写 `overrides` 是**无效的**——即使写了，使用方安装时也不会执行。这是设计上的限制：依赖不能反向操纵宿主项目的依赖树。

> 如果你是库作者，想约束传递依赖版本，应该用 `peerDependencies` 或在文档里说明，不能用 `overrides`。

##### 2. 修改后必须重新生成 lock 文件

仅改 `package.json` 不够，要触发解析更新：

```bash
rm -rf node_modules package-lock.json
npm install

# pnpm
rm -rf node_modules pnpm-lock.yaml
pnpm install

# 或者直接
npm install --package-lock-only
```

`npm install` 在已有 lock 文件时**可能不会重新解析 overrides**——保险起见删 lock 重装。

##### 3. 可能破坏 peerDependencies

强行覆盖到不兼容版本时，依赖里声明 peer 的包会警告甚至崩溃：

```json
{
  "overrides": {
    "react": "16.0.0"   // 但 react-router-dom@6 要求 react>=17
  }
}
```

`npm install` 会显示 `ERESOLVE` 错误。需要权衡：要么不 override，要么连 `react-router-dom` 一起降级，要么加 `--legacy-peer-deps` 跳过检查（不推荐）。

##### 4. 三家语法不互通，monorepo 要写多份

如果你的 CI 同时支持 npm/yarn/pnpm 用户，需要在 `package.json` 里写三份：

```json
{
  "overrides": {
    "lodash": "4.17.21"
  },
  "resolutions": {
    "lodash": "4.17.21"
  },
  "pnpm": {
    "overrides": {
      "lodash": "4.17.21"
    }
  }
}
```

##### 5. 不要滥用——这是临时手段

`overrides` 是**应急方案**，不是常规配置。它会让依赖图与各包的实际声明不一致，长期使用会：

- 升级时排查问题更困难
- 新成员看到时一头雾水
- 静默地把不兼容的版本组合起来

**最佳实践**：每条 override 都加注释说明原因和何时可以移除：

```json
{
  "overrides": {
    "axios": "^1.6.0"
  },
  "_overridesNotes": {
    "axios": "CVE-2024-39338 fix; remove when package-x upgrades to >=2.0"
  }
}
```

定期审计 `_overridesNotes`，过期的 override 及时清掉。

##### 6. 不影响 `npm publish` 后下游

你包里写的 `overrides` 不会跟着发布出去——使用者装你的包时，他们的 `overrides` 才有效，不是你的。

#### 与相关工具的对比

| 工具                                                     | 作用机制                 | 适用场景                 |
| -------------------------------------------------------- | ------------------------ | ------------------------ |
| `overrides` / `resolutions`                          | 改写依赖树版本           | 替换、降级、升级整个依赖 |
| [`patch-package`](https://github.com/ds300/patch-package) | 安装后用 diff 打补丁     | 只改某个文件的几行代码   |
| [`pnpm patch`](https://pnpm.io/cli/patch)                 | pnpm 内置补丁机制        | pnpm 用户的同上场景      |
| `bundledDependencies`                                  | 把依赖打进自己的 tarball | 离线分发、强隔离         |
| fork 后发布私有版本                                      | 完全自维护               | 长期偏离上游             |

选择顺序通常是：**轻改用 patch-package → 整体换版本用 overrides → 长期维护就 fork**。

---

## 四、脚本与执行字段

### `scripts`

定义命令别名，通过 `npm run <name>` 执行。命令在 shell 中执行，`PATH` 会自动包含 `node_modules/.bin/`。

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest",
    "test:coverage": "vitest --coverage",
    "lint": "eslint src --ext .ts,.tsx",
    "lint:fix": "eslint src --ext .ts,.tsx --fix",
    "format": "prettier --write \"src/**/*.{ts,tsx,css}\"",
    "typecheck": "tsc --noEmit",
    "prepare": "husky install"
  }
}
```

**生命周期钩子**——npm 自动触发：

| 钩子                                                  | 触发时机                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| `preinstall` / `postinstall`                      | `npm install` 前/后                                      |
| `prepublish` / `prepublishOnly` / `postpublish` | `npm publish` 前/后                                      |
| `prepare`                                           | `npm install` 后、`npm publish` 前（git 依赖也会触发） |
| `prestart` / `poststart`                          | `npm start` 前/后                                        |
| `pretest` / `posttest`                            | `npm test` 前/后                                         |

也可以为任意自定义脚本加 `pre`/`post` 前缀：

```json
{
  "scripts": {
    "build": "vite build",
    "prebuild": "rimraf dist",
    "postbuild": "node scripts/copy-assets.js"
  }
}
```

---

### `engines`

声明对 Node.js / npm / pnpm 等运行时版本的要求。

```json
{
  "engines": {
    "node": ">=18.17.0",
    "npm": ">=9.0.0",
    "pnpm": ">=8.0.0"
  }
}
```

> 默认仅作警告。需要强制约束可在 `.npmrc` 加 `engine-strict=true`，或用 `engines.node` 配合 CI 检查。

---

### `os` / `cpu`

限制可安装的操作系统和 CPU 架构。

```json
{
  "os": ["darwin", "linux"],
  "cpu": ["x64", "arm64"]
}
```

排除某平台用 `!` 前缀：

```json
{
  "os": ["!win32"]
}
```

---

## 五、发布与包行为字段

### `private`

设为 `true` 后，npm 会**拒绝发布**该包。前端应用、内部项目应该始终设置。

```json
{
  "private": true
}
```

---

### `publishConfig`

发布时覆盖默认的 npm 配置，常用于：

- 发布到私有 registry
- 作用域包公开发布

```json
{
  "publishConfig": {
    "registry": "https://npm.mycompany.com",
    "access": "public",
    "tag": "next"
  }
}
```

---

### `type`

声明包的模块系统，**Node.js 12+ 关键字段**。

- `"commonjs"`（默认）：`.js` 文件被当作 CJS
- `"module"`：`.js` 文件被当作 ESM

```json
{
  "type": "module"
}
```

> 设置后，CJS 文件需用 `.cjs` 后缀，ESM 文件可以用 `.js` 或 `.mjs`。

---

### `sideEffects`

告诉打包工具（webpack、rollup）哪些文件**没有副作用**，可以安全 tree-shaking 删除。

无副作用：

```json
{
  "sideEffects": false
}
```

部分文件有副作用（如全局 polyfill、CSS 引入）：

```json
{
  "sideEffects": [
    "*.css",
    "./src/polyfills.js"
  ]
}
```

> 工具库应正确声明此字段，否则使用方无法 tree-shake，会引入冗余代码。

---

## 六、工作区与 Monorepo 字段

### `workspaces` （npm/yarn）

声明 monorepo 子包路径。

```json
{
  "name": "my-monorepo",
  "private": true,
  "workspaces": [
    "packages/*",
    "apps/*"
  ]
}
```

或带配置（yarn）：

```json
{
  "workspaces": {
    "packages": ["packages/*"],
    "nohoist": ["**/react-native"]
  }
}
```

> pnpm 不读 `workspaces`，使用根目录的 `pnpm-workspace.yaml`。

---

### 子包内引用工作区其他包

npm/yarn：

```json
{
  "dependencies": {
    "@myorg/utils": "*"
  }
}
```

pnpm 推荐用 `workspace:` 协议：

```json
{
  "dependencies": {
    "@myorg/utils": "workspace:*",
    "@myorg/ui": "workspace:^1.0.0"
  }
}
```

---

## 七、内嵌的工具配置字段

许多工具支持把配置写在 `package.json` 里，避免根目录文件爆炸。

```json
{
  "browserslist": [
    "> 1%",
    "last 2 versions",
    "not dead",
    "not ie 11"
  ],

  "eslintConfig": {
    "extends": ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
    "parser": "@typescript-eslint/parser"
  },

  "prettier": {
    "semi": false,
    "singleQuote": true,
    "trailingComma": "all",
    "printWidth": 100
  },

  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "jsdom"
  },

  "babel": {
    "presets": ["@babel/preset-env", "@babel/preset-react"]
  },

  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{css,md}": ["prettier --write"]
  },

  "husky": {
    "hooks": {
      "pre-commit": "lint-staged"
    }
  },

  "commitlint": {
    "extends": ["@commitlint/config-conventional"]
  }
}
```

> 团队偏好上：**简单配置内嵌**、**复杂配置独立文件**（`.eslintrc.js`、`prettier.config.js` 等），后者还能写注释和逻辑。

---

## 八、完整示例对比

### 示例 A：工具库（npm 发布的开源库）

```json
{
  "name": "@myorg/awesome-utils",
  "version": "1.2.3",
  "description": "A collection of awesome utility functions for modern JavaScript.",
  "keywords": ["utility", "typescript", "esm"],
  "homepage": "https://github.com/myorg/awesome-utils#readme",
  "bugs": "https://github.com/myorg/awesome-utils/issues",
  "license": "MIT",
  "author": "Jane Doe <jane@example.com>",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/myorg/awesome-utils.git"
  },

  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    },
    "./array": {
      "types": "./dist/array.d.ts",
      "import": "./dist/array.mjs",
      "require": "./dist/array.cjs"
    },
    "./package.json": "./package.json"
  },
  "sideEffects": false,

  "files": ["dist", "README.md", "LICENSE"],

  "scripts": {
    "build": "tsup src/index.ts src/array.ts --format esm,cjs --dts --clean",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "npm run lint && npm run test && npm run build"
  },

  "peerDependencies": {
    "typescript": ">=4.7.0"
  },
  "peerDependenciesMeta": {
    "typescript": { "optional": true }
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "eslint": "^8.56.0",
    "tsup": "^8.0.0",
    "typescript": "^5.3.0",
    "vitest": "^1.1.0"
  },

  "engines": {
    "node": ">=18.0.0"
  },

  "publishConfig": {
    "access": "public"
  }
}
```

**关注点**：

1. 完整的 `exports` 多入口 + 条件导出
2. `sideEffects: false` 帮助使用者 tree-shake
3. `files` 白名单只发布 `dist`
4. `peerDependencies` 声明 TS 为可选对等依赖
5. `prepublishOnly` 钩子保证发布前质量

---

### 示例 B：前端应用（Vite + React + TypeScript）

```json
{
  "name": "my-web-app",
  "version": "0.1.0",
  "private": true,
  "type": "module",

  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest",
    "test:e2e": "playwright test",
    "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
    "lint:fix": "eslint . --ext ts,tsx --fix",
    "format": "prettier --write \"src/**/*.{ts,tsx,css,md}\"",
    "typecheck": "tsc --noEmit",
    "prepare": "husky install"
  },

  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.21.0",
    "@tanstack/react-query": "^5.17.0",
    "zustand": "^4.4.7",
    "axios": "^1.6.5",
    "clsx": "^2.1.0"
  },

  "devDependencies": {
    "@types/react": "^18.2.43",
    "@types/react-dom": "^18.2.17",
    "@typescript-eslint/eslint-plugin": "^6.14.0",
    "@typescript-eslint/parser": "^6.14.0",
    "@vitejs/plugin-react": "^4.2.1",
    "eslint": "^8.55.0",
    "eslint-plugin-react-hooks": "^4.6.0",
    "eslint-plugin-react-refresh": "^0.4.5",
    "husky": "^8.0.3",
    "lint-staged": "^15.2.0",
    "playwright": "^1.40.0",
    "prettier": "^3.1.1",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.3.3",
    "vite": "^5.0.8",
    "vitest": "^1.1.0"
  },

  "browserslist": {
    "production": [">0.2%", "not dead", "not op_mini all"],
    "development": [
      "last 1 chrome version",
      "last 1 firefox version",
      "last 1 safari version"
    ]
  },

  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md,css}": ["prettier --write"]
  },

  "engines": {
    "node": ">=18.17.0",
    "pnpm": ">=8.0.0"
  },

  "packageManager": "pnpm@8.14.0"
}
```

**关注点**：

1. `private: true` 防止误发布
2. **没有** `main`/`module`/`exports`/`files`——应用不被引用
3. **没有** `peerDependencies`——应用是终端
4. 框架运行时放 `dependencies`，构建/lint 工具放 `devDependencies`
5. `browserslist` 影响 Vite/Babel 的目标产物
6. `packageManager` 字段（Corepack 支持）锁定包管理器版本

---

### 示例 C：CLI 工具

```json
{
  "name": "create-my-app",
  "version": "2.0.0",
  "description": "Scaffold a new project with my preferred config.",
  "license": "MIT",
  "type": "module",

  "bin": {
    "create-my-app": "./bin/index.js"
  },

  "files": ["bin", "templates", "README.md"],

  "scripts": {
    "test": "vitest run"
  },

  "dependencies": {
    "commander": "^11.1.0",
    "inquirer": "^9.2.12",
    "chalk": "^5.3.0",
    "execa": "^8.0.1"
  },

  "engines": {
    "node": ">=18.0.0"
  },

  "preferGlobal": true
}
```

**关注点**：

1. `bin` 注册命令，使用方 `npx create-my-app` 或 `npm i -g` 后直接运行
2. `bin/index.js` 必须以 `#!/usr/bin/env node` 开头
3. `preferGlobal` 是提示性字段——本地安装时给出建议

---

## 九、不太常见但有用的字段

| 字段               | 作用                                                         |
| ------------------ | ------------------------------------------------------------ |
| `packageManager` | 配合 Corepack 锁定包管理器版本，如 `"pnpm@8.14.0"`         |
| `imports`        | 包内部 subpath imports，配合 `#` 前缀的别名导入            |
| `funding`        | 赞助/资助链接，`npm fund` 会显示                           |
| `directories`    | 声明项目目录结构（如 `lib`、`bin`、`man`），现在很少用 |
| `man`            | Unix `man` 手册页路径                                      |
| `config`         | 给 `scripts` 注入环境变量（`npm_package_config_*`）      |
| `preferGlobal`   | CLI 包的提示性字段，本地安装时给用户建议改用全局             |

`imports` 示例（包内别名）：

```json
{
  "imports": {
    "#utils/*": "./src/utils/*.js",
    "#config": {
      "node": "./config/node.js",
      "default": "./config/default.js"
    }
  }
}
```

```js
import { format } from '#utils/format';
import config from '#config';
```

---

## 十、最佳实践速查清单

### 工具库

- ✅ 同时提供 `main`（CJS）、`module`（ESM）、`types`
- ✅ 用 `exports` 配置多入口和条件导出
- ✅ 用 `files` 白名单控制发布产物
- ✅ 正确设置 `sideEffects` 帮助 tree-shaking
- ✅ 框架/宿主依赖放 `peerDependencies` 而非 `dependencies`
- ✅ 用 `prepublishOnly` 钩子做发布前检查
- ❌ 不要把构建产物以外的源码发布出去

### 前端应用

- ✅ 设置 `private: true`
- ✅ 用 `engines` + `packageManager` 锁定运行环境
- ✅ 区分清楚 `dependencies`（运行时）和 `devDependencies`（构建期）
- ✅ 配置 `browserslist` 控制目标浏览器
- ✅ 用 `husky` + `lint-staged` 做提交前校验
- ❌ 不需要 `main`、`module`、`exports`、`files`、`peerDependencies`

### 通用

- ✅ 锁定包管理器（`packageManager` 字段）
- ✅ 配套提交锁文件（`package-lock.json` / `yarn.lock` / `pnpm-lock.yaml`）
- ✅ 慎用 `*` 或过宽版本范围
- ✅ 定期 `npm outdated` / `npm audit` 检查依赖

---

## 参考资源

- [npm Docs - package.json](https://docs.npmjs.com/cli/v10/configuring-npm/package-json)
- [Node.js - Modules: Packages](https://nodejs.org/api/packages.html)
- [SemVer](https://semver.org/lang/zh-CN/)
- [SPDX License List](https://spdx.org/licenses/)
- [pnpm workspace](https://pnpm.io/workspaces)
