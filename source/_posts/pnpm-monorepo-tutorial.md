---
title: pnpm Monorepo 实战指南：workspace、catalog 与 pnpm 11 供应链安全
date: 2026-05-13 10:00:00
tags:
  - 前端
  - Node.js
  - pnpm
  - Monorepo
categories:
  - 前端
description: 从 workspace 协议、catalog 版本治理到 Changesets 发布流程，完整覆盖 pnpm 10/11 搭建 monorepo 的核心环节，并重点解析 pnpm 11 的供应链安全新默认（minimumReleaseAge、blockExoticSubdeps）。
cover: https://picsum.photos/seed/pnpm-monorepo-tutorial/800/450
---

> 适用版本：pnpm 10 / 11,Node.js 22 / 24 (LTS)  
> 最后更新:2026 年 8 月

## 前言

### 什么是 Monorepo?

Monorepo(单一仓库)是一种将多个相关项目(包)放在同一个代码仓库中管理的策略。与之相对的是 Polyrepo(多仓库)模式。常见的使用场景包括:

- 一个产品由多个前端应用 + 共享组件库构成
- 同时维护客户端 SDK、服务端 SDK 和文档站点
- 工具链 + 多个示例项目

### 为什么选 pnpm?

pnpm 通过**硬链接(hard link)+ 内容寻址存储**实现了节省磁盘空间和极快的安装速度。相比 npm/yarn 的 workspace,它有几个明显优势:

1. **严格的依赖隔离**:默认不会让你访问未声明的间接依赖(避免幽灵依赖)
2. **磁盘占用小**:同一版本的依赖在全局只存一份
3. **原生 workspace 支持**:内置 `--filter`、`-r` 等强大命令
4. **`workspace:` 协议**:清晰表达本地包依赖
5. **供应链安全**:pnpm 11 默认开启 `minimumReleaseAge`(新包 24 小时内不解析)和阻止异常子依赖

---

## 一、环境准备

### 1. 安装 Node.js

推荐使用 **Node.js 24 LTS**(活跃支持至 2026-10,之后进入维护期,2028-04 EOL)或 Node.js 22(已在维护期,2027-04 EOL)。可以通过 [nvm](https://github.com/nvm-sh/nvm) 管理多版本:

```bash
nvm install 24
nvm use 24
```

> ⚠️ Node 18 / 20 已 EOL,pnpm 11 要求 Node 22+,请勿继续使用。

### 2. 安装 pnpm

如果你在 **Node.js 24 或更早**的版本上,可以用 corepack 按项目锁定 pnpm 版本:

```bash
corepack enable
corepack use pnpm@11        # 顺便把 packageManager 字段写进 package.json
```

> ⚠️ **corepack 正在退场**:Node.js TSC 已投票停止分发 corepack,**Node 25+ 的官方发行版不再自带**,Node 24 中也仅作为实验特性保留。所以别再把"corepack 是 Node 自带的"当成理所当然。如果你的环境里没有它,直接全局装 pnpm 就行:
>
> ```bash
> npm install -g pnpm@11
> # 或者单独把 corepack 装回来:npm install -g corepack
> ```

验证安装:

```bash
pnpm --version    # 期望 11.x(本文示例基于 11.18)
```

---

## 二、初始化项目

### 1. 创建项目目录

```bash
mkdir my-monorepo && cd my-monorepo
git init
pnpm init
```

### 2. 配置根 `package.json`

编辑根目录的 `package.json`,设为私有项目(避免误发布):

```json
{
  "name": "my-monorepo",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@11.18.0",
  "engines": {
    "node": ">=22",
    "pnpm": ">=10"
  },
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint"
  }
}
```

> 💡 **关于版本字段**:`packageManager` 字段配合 corepack,可以让所有协作者自动使用同一个 pnpm 版本。pnpm 11 的 `pnpm init` 改为写入 `devEngines.packageManager`——corepack 只在**没有**顶层 `packageManager` 字段时才回退去读它,而且要求 `devEngines.packageManager.version` 是精确版本。目前保留 `packageManager` 兼容性更好:CI 里的 `pnpm/action-setup` 读的也是这个字段。

### 3. 创建 `pnpm-workspace.yaml`

这是 pnpm 识别 monorepo 的关键文件。**注意**:从 pnpm 11 起,许多原本写在 `.npmrc` 里的配置(如 `auto-install-peers`、`shamefully-hoist`)必须搬到这里:

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
  # - '!**/test/**'  # 也可以用 ! 排除某些目录

# pnpm 10/11 通用配置
autoInstallPeers: true

# pnpm 11 安全默认(可选,按需调整)
# minimumReleaseAge: 1440      # 新版本发布 24 小时内不解析
# blockExoticSubdeps: true     # 阻止 Git/tarball 等异常子依赖
```

### 4. 推荐的目录结构

```
my-monorepo/
├── apps/                  # 可独立部署的应用
│   ├── web/
│   └── admin/
├── packages/              # 可复用的库 / 工具
│   ├── ui/
│   ├── utils/
│   └── config/            # 共享配置(tsconfig.base.json 等放这里)
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml         # 只有一份,位于根目录
└── .npmrc                 # 仅放认证 / registry 配置
```

---

## 三、创建第一个包

### 1. 创建一个工具包 `@my/utils`

```bash
mkdir -p packages/utils && cd packages/utils
pnpm init
```

编辑 `packages/utils/package.json`。注意 **`"type": "module"`**——本教程全程用 ESM 语法,缺了它 Node 会按 CJS 解析并报语法错误:

```json
{
  "name": "@my/utils",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.js",
  "scripts": {
    "build": "echo 'build utils'",
    "test": "echo 'test utils'"
  }
}
```

> 💡 两个细节:
> 1. pnpm 11 的 `pnpm init` 已经默认写入 `"type": "module"`,pnpm 10 及更早需要自己补。
> 2. 这里**刻意没写 `types` 字段**。本教程的包是纯 JS,没有任何环节产出 `.d.ts`;如果 `types` 指向一个不存在的文件,TypeScript 消费方会直接报错。等你接上真正的构建(tsc / tsup)产出声明文件后再补。

新建 `packages/utils/src/index.js`:

```js
export function add(a, b) {
  return a + b;
}

export function greet(name) {
  return `Hello, ${name}!`;
}
```

### 2. 创建一个应用 `@my/web`

回到仓库根目录,再创建应用:

```bash
cd ../..                       # 从 packages/utils 回到根
mkdir -p apps/web/src && cd apps/web
pnpm init
```

编辑 `apps/web/package.json`:

```json
{
  "name": "@my/web",
  "version": "0.0.1",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "node src/index.js",
    "build": "echo 'build web'"
  }
}
```

新建一个空入口 `apps/web/src/index.js`(先占位,下一节填充):

```js
// 待第四节填入
```

最后回到根目录:

```bash
cd ../..
```

---

## 四、包之间的依赖(workspace 协议)

这是 monorepo 最核心的能力——让一个包依赖仓库内的另一个包。

在**根目录**,给 `@my/web` 添加对 `@my/utils` 的依赖:

```bash
pnpm --filter @my/web add '@my/utils@workspace:*'
```

> ⚠️ **引号别省**。zsh(macOS 默认 shell)会把未加引号的 `*` 当成 glob 去匹配文件,匹配不到就直接报 `zsh: no matches found`,命令根本到不了 pnpm 手里。

执行后,`apps/web/package.json` 的 `dependencies` 会变成:

```json
{
  "dependencies": {
    "@my/utils": "workspace:*"
  }
}
```

### `workspace:` 协议的几种写法

| 写法 | 含义 |
|------|------|
| `workspace:*` | 任意版本,发布时替换为当前版本 |
| `workspace:^` | 替换为 `^x.y.z` |
| `workspace:~` | 替换为 `~x.y.z` |
| `workspace:1.2.3` | 锁定精确版本,发布时原样输出 `1.2.3` |
| `workspace:^1.2.3` | 一个 range(要求本地包满足 `^1.2.3`),发布时原样输出 `^1.2.3` |

发布到 npm 时,pnpm 会自动把 `workspace:*` 转换为实际版本号,所以**消费者完全感知不到 workspace 协议**。

### 在应用中使用

把 `apps/web/src/index.js` 的占位内容替换为:

```js
import { greet } from '@my/utils';

console.log(greet('Monorepo'));
```

运行:

```bash
pnpm --filter @my/web dev
# 输出:Hello, Monorepo!
```

---

## 五、依赖版本集中管理(Catalogs)

> 这一节解决 monorepo 几乎必然踩到的坑:**同一个第三方依赖,不同子包用了不同版本**。

### 1. 一个真实的灾难场景

假设你的 monorepo 有两个包:

- `packages/ui`:组件库,`package.json` 里依赖 `"react": "^18.0.0"`
- `apps/web`:消费 `@my/ui` 的应用,自己的 `package.json` 里依赖 `"react": "^19.0.0"`

pnpm 安装后,`node_modules` 里会同时存在**两份 React 实例**。`apps/web` 运行时渲染 `@my/ui` 的组件,hooks 调用会抛出 **"Invalid hook call"** 错误。

**为什么?** React 的 hooks 通过模块级的内部状态找到"当前正在渲染的组件"。如果 `@my/ui` 引用的 React 和 `apps/web` 引用的 React 不是同一个模块实例,hooks 就找不到对方。

这个陷阱并非 React 独有:

- **zod**:前后端跨 major 用了 v3 / v4,`err instanceof z.ZodError` 之类的判断会失败,类型也不互通
- **TypeScript**:不同包用不同版本编译,类型定义可能不兼容
- **eslint / prettier**:版本差异导致同事之间格式化结果不同

### 2. catalog: 协议入门

pnpm 9.5 引入的 `catalog:` 协议,把**需要统一的外部依赖版本集中到一处**——`pnpm-workspace.yaml`。

**第一步**:在 `pnpm-workspace.yaml` 里声明 catalog:

```yaml
packages:
  - 'packages/*'
  - 'apps/*'

autoInstallPeers: true

catalog:
  react: ^19.0.0
  react-dom: ^19.0.0
  typescript: ^7.0.0
  zod: ^4.4.0
  vitest: ^4.1.0
```

**第二步**:在子包 `package.json` 里**只写 `catalog:`,不写具体版本号**:

```json
{
  "name": "@my/ui",
  "dependencies": {
    "react": "catalog:",
    "react-dom": "catalog:"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

**第三步**:`pnpm install` 时,pnpm 自动用 catalog 里的版本号解析。所有用 `catalog:` 的子包**保证拿到同一个版本**。

> 💡 添加新依赖时也支持 catalog:`pnpm --filter @my/ui add react@catalog:` 会自动写入 `"react": "catalog:"`。

### 3. 升级流程

想把 React 的版本基线从 19.0 抬到 19.2,**只需要改一处**:

```yaml
catalog:
  react: ^19.2.0      # 改这里
  react-dom: ^19.2.0  # 配套更新
```

然后 `pnpm install`,所有用 `catalog:` 的子包同步获得新版本。再也不会出现"5 个 package.json 里 3 个忘了改"的情况。

### 4. 具名 catalogs(处理"一仓多版本"过渡期)

回到开头那个 React 18 / 19 共存的灾难——如果你**确实**需要让两组应用暂时用不同主版本(比如新应用上 React 19、老应用还卡在 React 18 因为某个老组件库没适配),可以用**具名 catalog**:

```yaml
catalogs:
  react18:
    react: ^18.3.0
    react-dom: ^18.3.0
  react19:
    react: ^19.0.0
    react-dom: ^19.0.0
```

子包按需引用:

```json
// apps/legacy/package.json
{ "dependencies": { "react": "catalog:react18" } }

// apps/new-product/package.json
{ "dependencies": { "react": "catalog:react19" } }
```

这种方式比让每个包自己写版本号好得多——**至少所有"用 React 18 的包"还是同一个版本**,升级时只改 catalog 一处。

> ⚠️ 即便用了具名 catalog,**共享组件库 `@my/ui` 也不应该硬绑死某个主版本**——应该把 react 放到 `peerDependencies`,让消费方决定走哪一组 catalog。

### 5. 真实例子:前后端共享 zod schema

这是内部业务 monorepo 最常见的模式——前后端共享类型定义:

```
packages/
└── schemas/        # zod 定义,导出类型 + 校验函数
    package.json:  { "dependencies": { "zod": "catalog:" } }
apps/
├── web/            # 前端:用 schema 做表单校验
│   package.json:  { "dependencies": {
│                      "zod": "catalog:",
│                      "@my/schemas": "workspace:*"
│                    } }
└── api/            # 后端:用 schema 做请求 body 校验
    package.json:  { "dependencies": {
                       "zod": "catalog:",
                       "@my/schemas": "workspace:*"
                     } }
```

`pnpm-workspace.yaml`:

```yaml
catalog:
  zod: ^4.4.0
```

**为什么必须用 catalog 而不是各自写版本?** 先澄清一个很常见的误解:如果前端写 `^4.3.0`、后端写 `^4.4.0`,这两个 range 是**兼容**的,pnpm 解析时会 dedupe 到同一个版本,`node_modules` 里只有一份 zod——**这种情况根本不会出事**。

真正会翻车的是另外两种:

1. **跨 major**:前端还停在 `^3.23.0`,后端已经升到 `^4.4.0`。此时 node_modules 里实打实存在两份 zod。`@my/schemas` 用 zod 4 定义的 schema 传到前端,`err instanceof z.ZodError` 会返回 `false`(两个 `ZodError` 压根不是同一个类),TypeScript 层面两套 `ZodType` 的类型也不互相兼容,`.parse()` 的返回值推断直接崩。
2. **写死精确版本**:前端 `"zod": "3.23.8"`、后端 `"zod": "3.24.1"`,没有 caret 兜底,pnpm 只能各装各的。

这两种情况在多人协作里非常容易发生:某个同事在自己那个包里随手 `pnpm add zod` 拉到最新 major,CI 全绿,直到运行时才炸。catalog 的价值就是把"升 major"从某个包的局部行为,变成一次显式的、全仓库同步的动作。

### 6. 哪些依赖应该放进 catalog?

不是所有依赖都需要 catalog。判断标准:

| 适合放 catalog | 不适合放 catalog |
|--------------|---------------|
| 框架核心:react, vue, next | 只在单个包里用到的工具 |
| 类型 / 编译工具:typescript, tsx | 一次性脚本依赖 |
| 跨包共享的运行时库:zod, lodash, dayjs | 实验性质的新依赖 |
| 测试工具:vitest, jest | 子包内部实现细节 |
| Lint / 格式化:eslint, prettier | |

**原则**:如果"两个以上子包用同一个依赖,且版本必须一致",就放 catalog。

### 7. 与 Changesets 配合

升级 catalog 里的依赖版本时,是否要为子包生成 changeset?看情况:

- **生产依赖升级**(如 react)→ 给所有使用它的子包打 `patch` changeset(消费方应该感知)
- **开发依赖升级**(如 vitest、prettier)→ 通常不需要 changeset(不影响发布产物)

> ⚠️ 别指望用 `.changeset/config.json` 的 `ignore` 来做这件事——它是一个**包名列表**(支持 glob),语义是"这些包即使被 changeset 引用也不发布",和 devDependencies 毫无关系。而且 changeset 文件本来就是人手写的,升级 devDependencies 不会自动触发任何 bump。真正控制内部依赖 range 如何更新的选项叫 `updateInternalDependencies`(取值 `patch` / `minor`)。所以这一条靠的是**团队约定**,不是配置项。

---

## 六、统一运行脚本

pnpm 提供了强大的命令组合能力。

### 1. 在所有包中执行

```bash
pnpm -r build              # 在每个包里运行 build
pnpm -r --parallel dev     # 并行执行
```

### 2. 用 `--filter` 精确选择

```bash
# 只在 web 应用中运行
pnpm --filter @my/web build

# 在 packages 目录下所有包中运行
pnpm --filter './packages/**' test

# 运行 @my/web 及其所有依赖的包
pnpm --filter @my/web... build

# 运行 @my/utils 自身 + 所有依赖它的包(反向)
pnpm --filter ...@my/utils build

# 只在相对 origin/main 有变更的包、以及它们的下游中运行
pnpm --filter '...[origin/main]' test

# 只要变更包本身,不带下游
pnpm --filter '[origin/main]' test
```

> 💡 `...` 的位置很关键,而且**两种写法都包含目标包自身**:
> - `<pkg>...`(后缀)= 该包 **+ 它的依赖**(上游)
> - `...<pkg>`(前缀)= 该包 **+ 依赖它的包**(下游)
> - `[origin/main]` = 变更包本身;加上前缀写成 `...[origin/main]` 才会带上它们的下游

### 3. 给根目录加依赖

有些工具(如 TypeScript、ESLint、Prettier)适合装在根目录:

```bash
pnpm add -D -w typescript eslint prettier
```

`-w` 表示装到 workspace 根。

---

## 七、共享 TypeScript / ESLint 配置

把通用配置抽到 `packages/config` 里:

```
packages/config/
├── package.json
├── tsconfig.base.json
└── eslint.config.js
```

`packages/config/package.json`(**注意 `private: true`,内部配置包不应发布**):

```json
{
  "name": "@my/config",
  "version": "0.1.0",
  "private": true,
  "files": ["tsconfig.base.json", "eslint.config.js"]
}
```

在子包中引用:

```jsonc
// packages/utils/tsconfig.json
{
  "extends": "@my/config/tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

别忘了添加依赖:

```bash
pnpm --filter @my/utils add -D '@my/config@workspace:*'
```

---

## 八、版本管理与发布(Changesets)

[Changesets](https://github.com/changesets/changesets) 是当前最流行的 monorepo 版本管理工具。

### 1. 安装

```bash
pnpm add -D -w @changesets/cli
pnpm changeset init
```

会生成 `.changeset/config.json`。

### 2. 工作流程

每次提交修改时:

```bash
pnpm changeset
```

它会交互式地问你:
- 哪些包有变更?
- 是 major / minor / patch?
- 简短说明?

执行后会在 `.changeset/` 目录生成一个 markdown 文件,**提交到 git**。

### 3. 发布

```bash
pnpm changeset version    # 按 changeset 文件计算新版本号并更新 package.json
pnpm install              # 更新 lockfile
pnpm changeset publish    # 发布所有有版本变更的包,并打 git tag
```

**为什么用 `pnpm changeset publish` 而不是 `pnpm -r publish`?**

先排除一个流传很广的误解:`pnpm -r publish` **不会**在遇到已发布版本时报错。官方的说法是"发布所有在 registry 上还不存在该版本的包",已经发过的会安静跳过,想强行重发才需要 `--force`。

两者真正的区别在别处:

- `changeset publish` 的依据是**已消费的 changeset 记录**,并会自动为每个发布的包打 `git tag`,和 changelog 生成串在同一条流水线上。
- `pnpm -r publish` 的依据是**查 registry 比对版本号**,不打 tag、不管 changelog。

如果你已经在用 Changesets,就没理由绕开它的 publish。

> 💡 **协议替换发生在打包那一刻,不在 `changeset version`**。`changeset version` 只做两件事:bump 版本号、更新内部依赖的 range(并且**保留** `workspace:` 前缀)。真正把 `workspace:*` 和 `catalog:` 换成实际版本号的是 `pnpm publish` / `pnpm pack`——这也正是这两个协议对下游消费者始终透明的原因。

---

## 九、常见问题与最佳实践

### 1. `.npmrc` 推荐配置

**重要**:从 pnpm 11 起,`.npmrc` **只允许放认证和 registry 相关配置**,其他设置必须放到 `pnpm-workspace.yaml`(或全局的 `~/.config/pnpm/config.yaml`)。

同一次改动里还有一个容易漏掉的点:pnpm 11 **不再读取 `npm_config_*` 环境变量**,要用 `pnpm_config_*` 前缀。CI 里如果靠环境变量注入过 pnpm 配置,升级时记得一起改。

在根目录新建 `.npmrc`:

```ini
# 锁定 registry
registry=https://registry.npmjs.org/

# 私有 scope 示例(按需)
# @mycompany:registry=https://npm.pkg.github.com/
```

其他 pnpm 行为配置(如 `autoInstallPeers`、`minimumReleaseAge`)放在 `pnpm-workspace.yaml`:

```yaml
autoInstallPeers: true
# minimumReleaseAge: 1440        # pnpm 11 默认即 1440
# blockExoticSubdeps: true       # pnpm 11 默认 true
```

> ⚠️ 如果你还在 pnpm 10,`.npmrc` 仍然支持完整配置,但建议提前迁移以兼容 v11。

### 2. `.gitignore`

```
node_modules/
dist/
.turbo/
*.log
.DS_Store
.env.local
```

注意:**不要忽略 `pnpm-lock.yaml`**,必须提交到 git。

### 3. 与 Turborepo 配合(可选)

当包数量增多、构建变慢时,可以引入 [Turborepo](https://turbo.build/) 做增量构建和远程缓存:

```bash
pnpm add -D -w turbo
```

然后用 `turbo run build` 替代 `pnpm -r build`,享受缓存加速。

Changesets 和 Turborepo 是**正交的两件事**:前者管"发什么版本",后者管"构建怎么更快",通常同时使用。

### 4. CI 中加速安装

```yaml
# GitHub Actions 示例
- uses: pnpm/action-setup@v6
  # 注意:这里不要再写 version。根 package.json 里已经有 packageManager 字段,
  # 两处都指定版本会直接报 "Multiple versions of pnpm specified"
- uses: actions/setup-node@v7
  with:
    node-version: 24
    cache: 'pnpm'
- run: pnpm install --frozen-lockfile
- run: pnpm -r build
```

`--frozen-lockfile` 会保证锁文件不被修改,在 CI 中是必备的。

### 5. pnpm 11 的新默认行为

如果升级到 pnpm 11,第一次安装可能感觉"变慢"或包没装上,多半是这两个新默认导致的:

- **`minimumReleaseAge: 1440`**:刚发布 24 小时内的版本不会被解析。需要紧急修复时,设为 0 或对特定包设 `minimumReleaseAgeExclude`。
- **`blockExoticSubdeps: true`**:拒绝 Git/tarball 等非 registry 来源的传递性依赖。如果你依赖的某个包用了 git 子依赖,会装失败,需要显式 allow。

这些都是为了防御 npm 供应链攻击,**生产环境强烈建议保留默认值**。

### 6. 常见坑

- **ESM/CJS 混用**:所有用 `import`/`export` 的包必须显式声明 `"type": "module"`,否则在 Node.js 下运行报语法错误。
- **包名冲突**:所有内部包推荐用统一 scope(如 `@my/`),避免污染全局命名空间。
- **循环依赖**:pnpm 默认只打一条 `There are cyclic workspace dependencies` 的 **WARN**,命令照跑,只是不再保证脚本按拓扑顺序执行——这比直接报错更危险,因为构建产物可能悄悄是错的。想让它直接失败,在 `pnpm-workspace.yaml` 里设 `disallowWorkspaceCycles: true`。
- **路径别名**:TypeScript 的 `paths` 配置在 monorepo 中容易出问题,**优先使用 `workspace:` 协议而不是路径别名**。
- **node_modules 位置**:pnpm 会同时在根目录和子包中创建 `node_modules`,这是正常的。子包的 `node_modules` 本身是真实目录,里面装的**条目**才是指向根部 `.pnpm` 存储的符号链接。

---

## 十、完整命令速查表

| 命令 | 作用 |
|------|------|
| `pnpm install` | 安装所有依赖 |
| `pnpm add <pkg> -w` | 添加到根 workspace |
| `pnpm --filter <name> add <pkg>` | 给某个包添加依赖 |
| `pnpm --filter <name> add <pkg>@catalog:` | 添加并自动使用 catalog 中的版本 |
| `pnpm -r <script>` | 在所有包中执行 |
| `pnpm --filter <name>... <script>` | 在某包及其依赖中执行 |
| `pnpm --filter '...[origin/main]' <script>` | 只在变更包及其下游中执行 |
| `pnpm why <pkg>` | 查看依赖来源 |
| `pnpm list -r --depth=0` | 列出所有 workspace 包 |
| `pnpm changeset` | 创建版本变更记录 |
| `pnpm changeset version` | 应用变更,更新版本 |
| `pnpm changeset publish` | 发布有版本变更的包 |

---

## 总结

到这里,你应该已经掌握了:

- ✅ 用 `pnpm-workspace.yaml` 声明 monorepo 结构
- ✅ 用 `workspace:` 协议管理内部依赖
- ✅ 用 `catalog:` 协议统一外部依赖版本,杜绝多版本灾难
- ✅ 用 `--filter` 精确控制脚本执行范围
- ✅ 用 Changesets 做版本管理和发布
- ✅ 适配 pnpm 10/11 的 `.npmrc` 与 workspace 配置变化
- ✅ CI/CD 和最佳实践

**下一步建议**:
1. 给你的真实项目尝试搭建一次
2. 引入 Turborepo 优化构建速度
3. 阅读 pnpm 官方文档了解更多高级特性:<https://pnpm.io/zh/workspaces>
4. 关注 pnpm 11 的供应链安全特性:<https://pnpm.io/blog/releases/11.0>

祝你 Monorepo 之旅顺利!🚀
