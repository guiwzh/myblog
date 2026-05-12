---
title: 硬链接与符号链接深度解析：从 Unix 文件系统原理到 pnpm 工程实践
date: 2026-05-13 14:00:00
tags:
  - 操作系统
  - 文件系统
  - pnpm
  - Node.js
categories:
  - 前端
description: 从 inode、目录项、数据块讲起，彻底厘清硬链接与符号链接的语义差异、跨设备约束与权限模型，再以 pnpm 的内容寻址存储和 .pnpm 虚拟目录为实战案例，串起两种链接的设计哲学与工程价值。
cover: https://picsum.photos/seed/hard-link-symlink-pnpm-deep-dive/800/450
---

> 一篇从文件系统基础讲到 pnpm 真实结构的文章。
>
> 前半部分讲机制，后半部分用 pnpm 这个真实案例，把两种链接的设计哲学和工程价值串起来。

---

## 一、起点：Unix 文件系统的真相

要理解链接，先得知道一件颠覆直觉的事：**在 Unix/Linux 里，"文件名"和"文件本身"是两个独立的东西**。

一个文件在磁盘上其实由三部分组成：

```
名字              身份证号           实际内容
foo.txt    →    inode #123456    →    "hello world..."
(目录项)         (索引节点)            (数据块)
```

逐个解释：

**inode（索引节点）** 是文件**真正的身份**。它存的东西包括：

- 文件类型（普通文件 / 目录 / 链接 / 设备...）
- 大小
- 权限（rwx）
- 所有者、组
- 创建/修改/访问时间
- **指向数据块的指针**
- **链接计数**（有几个名字指向我）

注意：**inode 里没有文件名**。每个 inode 有一个编号（如 `#123456`），在它所在的文件系统内唯一。

**数据块** 存的是文件的实际字节内容。inode 通过指针指过去。

**目录项** 才是"文件名"——它只是某个目录里的一张表里的一行：

```
目录 /home/alice/ 的内容（本身也是文件）：
┌──────────────┬──────────────┐
│   文件名     │   inode 号   │
├──────────────┼──────────────┤
│   foo.txt    │   123456     │
│   bar.png    │   123457     │
│   notes/     │   123458     │
└──────────────┴──────────────┘
```

所以当你执行 `cat /home/alice/foo.txt`，内核做的事是：

1. 打开 `/home/alice/` 目录文件，扫它的内容表
2. 找到 `"foo.txt"` 这一行，拿到 inode 号 `123456`
3. 读 inode `123456`，拿到数据块指针
4. 读数据块，输出内容

理解了这层"名字 / 身份 / 内容"的三段式，硬链接和符号链接就只是一句话的事。

> **一个推论先记住**：`rm foo.txt` 删除的不是文件，而是把 `"foo.txt"` 这一行从目录表里抹掉，并把对应 inode 的链接计数减 1。**只有当链接计数降到 0**，inode 和数据块才被回收。系统调用的名字就叫 `unlink(2)`——"解除一个名字和 inode 的绑定"。

---

## 二、硬链接 (Hard Link)

### 一句话定义

**硬链接：让多个目录项指向同一个 inode。**

就这么简单。所谓"建立硬链接"，就是在某个目录的表里**加一行新记录**，让新的文件名指向已存在的 inode 号。

### 动手实验

```bash
mkdir /tmp/link-lab && cd /tmp/link-lab

echo "I am the original" > a.txt
ln a.txt b.txt              # 创建硬链接（注意：没有 -s）

ls -li
```

输出：

```
123456 -rw-r--r-- 2 you you 18 May 12 10:00 a.txt
123456 -rw-r--r-- 2 you you 18 May 12 10:00 b.txt
```

两个关键观察：

- 最左边的 inode 号 `123456` **完全相同**——它们是同一个 inode 的两个名字
- 第二列的数字 `2` 是**链接计数**——这个 inode 现在被 2 个目录项引用

### 关键性质

**1. 删除一个不影响另一个**

```bash
rm a.txt           # 链接计数变成 1，inode 仍然存在
cat b.txt          # 仍然能读到 "I am the original"
```

**2. 硬链接之间完全平等**

没有"原文件"和"链接"之分。`a.txt` 和 `b.txt` 谁先创建都一样，它们的地位 100% 对等。

**3. 修改一个等于修改所有**

因为只有一份数据，改谁都一样。

### 限制

- **不能跨文件系统**：inode 号只在一个文件系统内有效
- **普通用户不能硬链接目录**：会造成循环，文件系统遍历会崩
- **目标必须存在**：链接的是 inode，inode 都没有怎么链

---

## 三、符号链接 (Symbolic Link / 软链接)

### 一句话定义

**符号链接：一个特殊文件，它的内容是另一个文件的路径字符串。**

注意每一个字：
- "一个特殊的**文件**"——它有自己的 inode、自己的元数据
- "内容是路径字符串"——它的数据块里存的就是一串路径字符

### 动手实验

```bash
echo "I am the target" > target.txt
ln -s target.txt link.txt         # -s 表示 symbolic

ls -li
```

输出：

```
123456 -rw-r--r-- 1 you you 16 May 12 10:30 target.txt
789012 lrwxrwxrwx 1 you you 10 May 12 10:30 link.txt -> target.txt
```

仔细观察：

- `link.txt` 的 inode 号 `789012` 和 `target.txt` **完全不同**——它是个独立文件
- 文件类型是 `l`（link），不是 `-`（普通文件）
- 大小 **10 字节**，正好等于字符串 `"target.txt"` 的长度

### 访问时的工作流程

访问 `link.txt` 时，内核做的事：

1. 查目录项 → 拿到 inode `789012`
2. 读 inode → 发现是 symlink，读其数据块得到字符串 `"target.txt"`
3. **拿这个字符串重新走一遍路径解析**，就像你手动输入了 `target.txt`
4. 解析到 `target.txt` 的 inode `123456`，继续读

**关键点**：符号链接每次访问都要做一次额外的路径解析。它存的是"路径"，不是"对 inode 的引用"。

### 关键性质

**1. 删原文件，符号链接就废了（断链 / dangling link）**

```bash
rm target.txt
cat link.txt              # cat: link.txt: No such file or directory
ls -l link.txt            # 还在，但箭头指向不存在的东西
```

**2. 重新创建目标，符号链接自动"复活"**

```bash
echo "I am back" > target.txt
cat link.txt              # → "I am back"
```

注意这是个**新**的 `target.txt`，inode 大概率不同——但符号链接按字符串解析，它不在乎 inode。

**3. 可以指向不存在的目标、可以跨文件系统、可以链接目录**

因为它本质上只是存了个字符串，没有"必须本盘""不能是目录"的限制。

### 相对路径 vs 绝对路径

`ln -s` 后面写什么，**原样**存进符号链接里：

```bash
ln -s target.txt rel-link              # 存的就是字符串 "target.txt"
ln -s /tmp/link-lab/target.txt abs-link  # 存的是绝对路径
```

把这两个链接移到别处：

```bash
mv rel-link abs-link /tmp/elsewhere/
cd /tmp/elsewhere
cat rel-link              # 失败——按相对路径会找 /tmp/elsewhere/target.txt
cat abs-link              # 成功——绝对路径不受影响
```

---

## 四、对比图

下面这张图把两种机制并排放，建议盯着看一分钟，比读十段文字管用：

```
            硬链接                                  符号链接
                                                   
   目录项                                  目录项                          
   ┌────────┬─────────┐                   ┌────────┬─────────┐            
   │ a.txt  │ 123456  │                   │ a.txt  │ 123456  │            
   │ b.txt  │ 123456  │ ← 两个名字          │ c.txt  │ 789012  │ ← 不同 inode
   └────────┴─────────┘   共享 inode       └────────┴─────────┘            
       │       │                               │        │                  
       ↓       ↓                               ↓        ↓                  
   ┌───────────────┐                    ┌──────────┐  ┌──────────────┐    
   │ inode #123456 │                    │ #123456  │  │ #789012      │    
   │ 普通文件      │                    │ 普通文件 │  │ 类型: symlink│    
   │ 链接计数: 2   │                    │ 计数: 1  │  │ 大小: 5 字节 │    
   └───────┬───────┘                    └────┬─────┘  └──────┬───────┘    
           ↓                                 ↓               ↓             
   ┌───────────────┐                    ┌──────────┐  ┌──────────────┐    
   │ 数据块        │                    │ "hello"  │  │ "a.txt"      │    
   │ "hello"       │                    │ 实际内容 │  │ 路径字符串   │    
   └───────────────┘                    └──────────┘  └──────┬───────┘    
                                                              │             
                                              重新解析路径 ↓  │             
                                                              ↓             
                                                   按 "a.txt" 再查一次目录  

   两个名字共享数据                        c.txt 是独立文件，内容是个路径
   删一个，另一个仍可用                    删 a.txt，c.txt 变成断链
```

---

## 五、速查表

| 维度 | 硬链接 | 符号链接 |
|------|--------|----------|
| 本质 | 多个目录项共享 inode | 独立 inode，内容是路径字符串 |
| 占用空间 | 几乎 0（只多一行目录项） | 一个小文件（存路径） |
| 跨文件系统 | ❌ | ✅ |
| 链接目录 | ❌（普通用户） | ✅ |
| 原文件删除后 | 仍然有效 | 失效（断链） |
| 指向不存在的目标 | ❌ | ✅ |
| 访问性能 | 与原文件相同 | 多一次路径解析（通常可忽略） |
| `ls -l` 怎么显示 | 看不出（要看链接计数列） | `->` 显式标记，类型 `l` |
| 创建命令 | `ln source target` | `ln -s source target` |

---

## 六、动手验证

跑下面这段，亲眼看一下行为差异：

```bash
mkdir /tmp/proof && cd /tmp/proof

echo "v1" > original.txt
ln    original.txt hard.txt   # 硬链接
ln -s original.txt soft.txt   # 软链接

ls -li
# 注意：original.txt 和 hard.txt 的 inode 相同，链接计数为 2
#       soft.txt 是独立 inode，类型 l

# 修改内容
echo "v2" > original.txt
cat hard.txt    # → v2  (同 inode，自然同步)
cat soft.txt    # → v2  (按路径解析，找得到)

# 删原文件
rm original.txt
cat hard.txt    # → v2  正常工作
cat soft.txt    # → No such file or directory  断链

# 重新建一个 original
echo "v3" > original.txt
cat hard.txt    # → v2  指的还是原来那个 inode（被保留下来的）
cat soft.txt    # → v3  按名字重解析，找到新文件
```

最后一步特别值得品味：**新建的 `original.txt` 跟旧的同名但不同 inode**。硬链接拿的是旧 inode 的引用，所以看到旧内容；符号链接拿的是名字，每次都重查，所以看到新内容。

> **核心区别一句话**：硬链接绑定在"创建那一刻"（绑 inode），符号链接绑定在"访问那一刻"（按名字重新查）。两者所有行为差异都从这个时间差派生。

---

# 第二部分：pnpm 如何使用这两种链接

这是文章的重点。pnpm 的设计极其精彩——**它用两种链接各司其职，解决了 npm/yarn 多年的痛点**。理解了它的结构，你不仅会用 pnpm，还会真正理解链接的工程价值。

## 七、问题背景：npm/yarn 的两大痛点

### 7.1 痛点一：磁盘空间的浪费

假设你的电脑上有 50 个 Node 项目，每个都装了 `react@18.2.0`。在 npm/yarn 下：

```
project-A/node_modules/react/...   ← 一份完整文件
project-B/node_modules/react/...   ← 又一份完整文件
project-C/node_modules/react/...   ← 又一份
...
```

完全相同的字节，被复制了 50 份。这就是 npm 时代 `node_modules` 动辄几个 G 的元凶。

### 7.2 痛点二：幽灵依赖（phantom dependency）

npm 默认的"扁平 node_modules"长这样：

```
node_modules/
├── react/         ← 我的直接依赖
├── react-dom/     ← 我的直接依赖
└── scheduler/     ← react-dom 间接装的，我没声明
```

我的代码里能不能 `import scheduler from 'scheduler'`？**能跑！** 因为 Node 模块解析会沿着 `node_modules/` 查找。

但这是**致命陷阱**：

- 哪天 react-dom 升级，不再依赖 scheduler 了——你的代码突然崩了
- 你换个不通过 react-dom 间接装 scheduler 的项目，代码不能用了
- CI 在某些机器上能跑、某些机器上不能跑

这就是幽灵依赖：**用了没声明的包**。

### 7.3 pnpm 的解决方案预览

pnpm 用三层结构 + 两种链接来同时解决这两个问题：

```
   全局 store
       │
       │  硬链接（共享文件字节）
       ↓
   项目的 .pnpm/
       │
       │  符号链接（暴露入口）
       ↓
   项目的 node_modules（顶层）
```

下面把每一层拆开看。

---

## 八、pnpm 三层架构详解

### 8.1 第一层：全局 store——所有项目共享的"文件池"

**位置**（取决于操作系统）：

| 系统 | 路径 |
|------|------|
| Linux | `~/.local/share/pnpm/store/v3/` |
| macOS | `~/Library/pnpm/store/v3/` |
| Windows | `%LOCALAPPDATA%\pnpm\store\v3\` |

> `v3` 是 store 格式版本号。pnpm 升级大版本时可能换新目录。

**内部结构**：

```
~/.local/share/pnpm/store/v3/
└── files/
    ├── 00/
    │   └── 1a2b3c4d...     ← 一个文件，按内容哈希命名
    ├── 0a/
    │   └── 5e6f7g8h...     ← 另一个文件
    ├── ff/
    │   └── ...
    └── ...
```

关键点：

- 每个文件以它**内容的哈希**命名（来自包元数据的 integrity 字段，现代 npm 包是 SHA-512），前两位作为子目录避免单目录文件太多
- 这叫 **content-addressable storage（内容寻址存储）**
- 文件名跟原始名字（如 `index.js`、`package.json`）无关——纯粹按内容
- **相同内容只存一份**——这是去重的基础

举例：`react@18.2.0` 的 `index.js` 内容，被哈希成 `0a2b3c...`，就被存到 `files/0a/2b3c...`。任何项目要这个文件，**都指向这一份**。

### 8.2 第二层：项目内的虚拟 store `.pnpm/`

每个项目的 `node_modules/.pnpm/` 是一个"中转站"。它的结构是这样：

```
my-project/node_modules/
└── .pnpm/
    ├── react@18.2.0/
    │   └── node_modules/
    │       └── react/
    │           ├── index.js         ← 硬链接到 store
    │           ├── package.json     ← 硬链接到 store
    │           └── ... (其他文件都是硬链接)
    │
    ├── react-dom@18.2.0/
    │   └── node_modules/
    │       ├── react-dom/
    │       │   ├── index.js         ← 硬链接到 store
    │       │   └── ...
    │       ├── react                ← 符号链接 → ../../react@18.2.0/node_modules/react
    │       └── scheduler            ← 符号链接 → ../../scheduler@0.23.0/node_modules/scheduler
    │
    └── scheduler@0.23.0/
        └── node_modules/
            └── scheduler/
                └── ...               ← 硬链接到 store
```

注意里面的两种链接：

**硬链接**：每个包的"自己的文件"（如 react 的 index.js）都是硬链接到 store 的。

**符号链接**：每个包的"依赖"是符号链接到 `.pnpm/` 内其他包的目录。

来看 `react-dom@18.2.0/` 这个目录——它的 `node_modules/` 里有三样东西：
- `react-dom/` —— 它自己的代码（里面的文件都是硬链接到 store）
- `react` —— **符号链接**，指向 `.pnpm/` 里的 react 包
- `scheduler` —— **符号链接**，指向 `.pnpm/` 里的 scheduler 包

这就是 react-dom 怎么找到它的依赖：当 react-dom 的代码里 `require('react')` 时，Node 沿着 `node_modules/` 查找，正好就找到了这个符号链接，跟过去找到了 react 的代码。

### 8.3 第三层：node_modules 顶层——给项目用的入口

```
my-project/node_modules/
├── react        ← 符号链接 → .pnpm/react@18.2.0/node_modules/react
├── react-dom    ← 符号链接 → .pnpm/react-dom@18.2.0/node_modules/react-dom
└── .pnpm/...    ← 第二层
```

注意顶层**只有你声明的直接依赖**——`react` 和 `react-dom`。`scheduler` 不在顶层，因为你没声明它。

这就是幽灵依赖被消灭的方式：你写 `import scheduler from 'scheduler'`，Node 沿 `node_modules/` 找——没有！直接报错。**只有声明过的包才能被 import**。

### 8.4 完整的全景图

把三层放在一起：

```
┌─────────────────────────────────────────────────────┐
│  全局 store   ~/.local/share/pnpm/store/v3/files/  │
│                                                     │
│    aa/bbcc...   ← index.js 的真身（按内容哈希命名）  │
│    dd/eeff...   ← package.json 的真身               │
│    gg/hhii...   ← ...                               │
└─────────────────────────────────────────────────────┘
                       ▲
                       │ 硬链接：项目里的每个文件
                       │ 和 store 共享同一个 inode
                       │
┌─────────────────────────────────────────────────────┐
│  项目 my-project/node_modules/                      │
│                                                     │
│   .pnpm/                                            │
│     react@18.2.0/node_modules/react/                │
│       ├── index.js     ── 硬链接到 store            │
│       ├── package.json ── 硬链接到 store            │
│       └── ...                                       │
│                                                     │
│     react-dom@18.2.0/node_modules/                  │
│       ├── react-dom/                                │
│       │   └── *.js     ── 硬链接到 store            │
│       ├── react        ── 符号链接 ─→ ../../react@18.2.0/node_modules/react │
│       └── scheduler    ── 符号链接 ─→ ../../scheduler@0.23.0/node_modules/scheduler │
│                                                     │
│     scheduler@0.23.0/node_modules/scheduler/        │
│       └── *.js         ── 硬链接到 store            │
│                                                     │
│   react        ── 符号链接 ─→ .pnpm/react@18.2.0/node_modules/react        │
│   react-dom    ── 符号链接 ─→ .pnpm/react-dom@18.2.0/node_modules/react-dom │
│   （注意：scheduler 不在顶层——你没声明它）         │
└─────────────────────────────────────────────────────┘
```

读到这里建议停一下：**自己复述一遍 `import react from 'react'` 在这个结构下的解析路径**。

<details>
<summary>路径走完整版</summary>

1. Node 在 `my-project/node_modules/react` 找到符号链接
2. 跟随符号链接到 `my-project/node_modules/.pnpm/react@18.2.0/node_modules/react/`
3. 读 `package.json` 找入口（如 `index.js`）
4. 打开 `index.js`——这是一个硬链接，实际内容在 `~/.local/share/pnpm/store/v3/files/xx/yyyy...`
5. 但内核**不会感知到硬链接的存在**，因为硬链接对用户层完全透明。代码就这么跑起来了。

如果这个项目里 `react-dom` 又 `require('react')`：

1. Node 在 `my-project/node_modules/.pnpm/react-dom@18.2.0/node_modules/react` 找到**另一个**符号链接
2. 跟随到 `my-project/node_modules/.pnpm/react@18.2.0/node_modules/react/`——**同一个目录**
3. 后面流程一样

**美妙之处**：不管哪个包要 react，最终都跟到同一个 react 目录，里面的文件又都是硬链接到 store 的同一份字节。100% 去重，0 冗余。
</details>

---

## 九、为什么是这么设计的——每种链接的不可替代性

读完上面的结构，回过头来问：**为什么不能全用一种链接？**

### 9.1 为什么不能全用硬链接

**硬链接不能链接目录**。Node 模块解析是按目录走的——`require('react')` 要打开 `node_modules/react/` 这个目录，读它的 `package.json`，找入口文件。

整个 react 包是个目录树，不是一个文件。没法用硬链接把"整个 react 目录"挂到多处。**目录级别的"挂载"只能用符号链接**。

### 9.2 为什么不能全用符号链接

**核心是成本**：

- 符号链接本身是个独立的文件，要占 inode 和少量空间。100 个项目 × 每个 react 包里几百个文件，多出来的 inode 不容小觑
- 每次访问要做一次额外的路径解析（解析符号链接的字符串、再走一遍查找）
- 路径是字面字符串，store 路径一旦变化（用户改了 store 位置、或不同机器路径不同），所有符号链接全部失效

而硬链接：

- **不需要额外 inode**——它就是 store 文件的另一个名字而已
- 访问性能等同于直接打开原文件，零开销
- 内核维护，不受路径变化影响

所以 pnpm 的策略很务实：**能用硬链接（同一文件系统、文件级别）的地方就用硬链接，省钱省事；只在硬链接不行（要链接目录）的地方才用符号链接**。

### 9.3 设计哲学一句话

**硬链接做"内容去重"，符号链接做"结构组织"。**

- 文件级别的共享 → 硬链接（去重）
- 目录级别的导航 → 符号链接（路由）

两种工具各司其职，pnpm 把它们组合得像精密钟表。

---

## 十、自己动手验证

光看图不过瘾，跑一遍最有感觉。准备一个 sandbox 目录：

```bash
mkdir /tmp/pnpm-demo && cd /tmp/pnpm-demo
pnpm init
pnpm add react@18.2.0 react-dom@18.2.0    # 锁定版本，方便对照下面路径

# 看顶层 node_modules
ls -la node_modules/
```

你会看到：

```
lrwxrwxrwx  ... react -> .pnpm/react@18.2.0/node_modules/react
lrwxrwxrwx  ... react-dom -> .pnpm/react-dom@18.2.0/node_modules/react-dom
drwxr-xr-x  ... .pnpm
```

注意 `l` 开头——这些是符号链接。

进去看 react 包：

```bash
ls -li node_modules/.pnpm/react@18.2.0/node_modules/react/
```

你会看到每个文件的链接计数 ≥ 2——说明它有硬链接对应。

接下来这一步是关键：**找出那个文件的"另一份"在哪里**。

```bash
# Linux 写法
INODE=$(stat -c '%i' node_modules/.pnpm/react@18.2.0/node_modules/react/index.js)
# macOS 写法（BSD stat 参数不同）
# INODE=$(stat -f '%i' node_modules/.pnpm/react@18.2.0/node_modules/react/index.js)

# 用 pnpm 自己告诉你 store 在哪，比硬编码路径靠谱
STORE=$(pnpm store path)
echo "Store at: $STORE"

# 在 store 里搜同 inode 号的文件
find "$STORE/files" -inum "$INODE" 2>/dev/null
```

> 注意：`find -inum` 只能在同一文件系统内匹配。如果 `pnpm store path` 返回的位置和你的项目不在同一块盘上，硬链接根本没建立成功（退化成 copy 或 reflink），这个命令就找不到——这本身也是一个有用的诊断信号。

输出会指向 store 里的某个文件——**那就是真身**。`node_modules/.pnpm/react@18.2.0/node_modules/react/index.js` 不是一个"复制品"，它就是 store 里那个文件的**另一个名字**。

最后再做一个对比实验。新建第二个项目，装相同版本的 react：

```bash
mkdir /tmp/pnpm-demo-2 && cd /tmp/pnpm-demo-2
pnpm init
pnpm add react@18.2.0
```

看链接计数变化：

```bash
ls -li /tmp/pnpm-demo-2/node_modules/.pnpm/react@18.2.0/node_modules/react/index.js
```

链接计数变成了 3（你的两个项目各 1 + store 自己 1）。**两个项目共享同一份字节**。

---

## 十一、几个细节问题

### 11.1 Windows 上怎么办？

Windows 概念上也有硬链接（NTFS 上），但符号链接有个麻烦：**默认需要管理员权限**或开启"开发者模式"。

pnpm 在 Windows 上的对策：

- 文件级硬链接：照常用，NTFS 支持得不错
- 目录级链接：优先用 **junction point**（NTFS 的目录连接，普通用户可创建，但只能链接本地目录）
- 符号链接：只在 junction 不适用时才用，需要权限

所以 Windows 用户首次用 pnpm 一般不需要管理员权限——junction 兜住了大部分场景。

### 11.2 跨文件系统怎么办

如果 store 在 `~/.local/share/pnpm/store/`（在系统盘），项目在另一块盘 `/data/projects/` 上，**硬链接跨不过去**。pnpm 的策略：

1. 优先尝试 **reflink**（copy-on-write 复制）——Btrfs、APFS、XFS 部分版本支持。表现上跟硬链接差不多，但允许跨子卷
2. 否则**真复制一份**——退化成 npm 的行为，慢且占空间

可以通过把 store 路径改到和项目同盘来强制硬链接：

```bash
pnpm config set store-dir /data/.pnpm-store
```

### 11.3 `node-linker` 配置：换装方式

pnpm 提供三种 `node_modules` 装配方式（`.npmrc` 里 `node-linker=...`）：

| 模式 | 行为 | 适用场景 |
|------|------|----------|
| `isolated`（默认） | 上述三层结构 + 符号链接 | 推荐，严格隔离 |
| `hoisted` | 扁平 `node_modules`（npm 风格），但底层仍是硬链接到 store | 兼容某些工具（如老版 React Native、某些 bundler） |
| `pnp` | 完全无 `node_modules`，用 `.pnp.cjs` 清单文件 | Yarn PnP 风格，最快 |

注意**不管哪种模式，硬链接到 store 这层都不变**——pnpm 的去重永远在。区别只在顶层结构。

### 11.4 `pnpm store prune` 的优雅之处

随着你删项目、升级依赖，store 里会积累没人引用的旧文件。`pnpm store prune` 清理它们。

**它怎么知道哪些没人用？** 答案非常优雅——**直接查 inode 的链接计数**。

- 链接计数 = 1：说明只有 store 自己持有，没项目在引用 → 可以删
- 链接计数 ≥ 2：至少有一个项目在用 → 保留

这意味着 pnpm **不需要自己维护引用计数表**——文件系统已经免费提供了。删项目、删 `node_modules`、磁盘损坏，都不会让计数出错，因为它是内核维护的、原子的、绝对可靠。

> 这是个很值得学习的设计原则：**能用底层基础设施做的事，就不要自己实现**。

### 11.5 peer dependency 让事情更复杂

peer deps 的存在让 `.pnpm/` 结构会更精细一点。如果同一个包 X 在不同上下文里被搭配不同的 peer dep 版本使用，pnpm 会创建**虚拟版本**：

```
.pnpm/
├── react-redux@8.0.5(react@18.2.0)/         ← 配 react 18 时的实例
│   └── node_modules/
│       ├── react-redux/...
│       └── react -> ../../react@18.2.0/...
│
├── react-redux@8.0.5(react@17.0.2)/         ← 配 react 17 时的实例
│   └── node_modules/
│       ├── react-redux/...
│       └── react -> ../../react@17.0.2/...
```

注意目录名里多了 `(react@18.2.0)` 这种后缀，**括号里写明了 peer dep 是用哪个具体版本解析的**。两个目录的代码文件**还是硬链接到 store 里同一份字节**（因为 react-redux 的代码本身一样），变的只是符号链接指向。极致的去重。

> 历史小注：pnpm v7 及之前用下划线连接（`react-redux@8.0.5_react@18.2.0`），v8 起改成括号。括号更接近语义"react-redux 实例(配套的 peer)"，也避免了与版本号里可能出现的下划线冲突。如果你看到老文档或老项目里出现下划线格式，知道是同一回事就行。

---

## 十二、几个推论（"突然就懂了"环节）

读完上面，下面这些 pnpm 的行为应该都能自己推导出来：

**1. 为什么 pnpm 安装快？**

因为大部分"安装"操作只是创建目录项（硬链接 + 符号链接）。真正的字节下载只发生在 store 里第一次见到这个包时。后续 100 个项目装同包同版本，加起来的磁盘 I/O 不如 npm 装一次的多。

**2. 为什么 pnpm 严格？**

因为顶层 `node_modules/` 只有声明过的包是符号链接，没声明的根本不可见。npm 的扁平 `node_modules/` 让所有间接依赖意外可达——pnpm 用结构本身禁止了这件事。

**3. 为什么有时同事电脑能跑你不能？**

如果你们用了不同包管理器，或者用 npm 时依赖了幽灵依赖。pnpm 通过严格性提前暴露这类问题。

**4. 为什么 monorepo 里 pnpm 这么舒服？**

monorepo 里你有多个项目共享大量公共依赖。pnpm 的三层结构让"共享"变成天然行为——大家都通过 `.pnpm/` 链接到同一份 store 字节。

**5. 为什么 pnpm 装在不同盘上会变慢？**

跨文件系统不能用硬链接（inode 编号在不同文件系统里不通用），只能退化成纯 copy——慢且不去重。reflink 也帮不上忙，它同样要求在同一个文件系统内。解决办法：把 store 路径改到和项目同盘（`pnpm config set store-dir <同盘路径>`）。

**6. 为什么 Windows 上 pnpm 用着比较顺？**

因为它优先用 **junction point**（NTFS 的目录连接）而不是 Windows 的符号链接。junction 普通用户就能创建，符号链接才需要管理员或开发者模式。pnpm 把"需要管理员"这个体验问题在工程层面避开了。

**7. 为什么 `pnpm store prune` 不会误删？**

因为它信任 inode 的链接计数——内核维护、绝对可靠。链接计数 = 1 就是 store 自己持有，可以删；≥ 2 就有项目在用，保留。

**8. 为什么改了 `node_modules` 里的代码会同时影响多个项目？**（这是个坑）

因为是硬链接！如果你为了调试改 `node_modules/.pnpm/react@18.2.0/node_modules/react/index.js`，**所有用这个版本 react 的项目都会被改**，包括 store 里那份。pnpm 没有运行时的写入保护机制——硬链接本身在文件系统层就是透明的，谁也拦不住。

几种应对方案：

- 把 `package-import-method` 改成 `copy`：导入时就真复制，独立 inode，互不影响。代价是占空间、装得慢
- 在 APFS（macOS）、Btrfs、XFS 等支持 reflink 的文件系统上，pnpm 会用 CoW（写时复制）替代硬链接：表面看一样，但**首次写入会自动分裂**——这是文件系统层面给的保护，不是 pnpm 的功劳
- 最稳妥：**别手改 `node_modules`**。要给三方包打补丁就用 `pnpm patch <pkg>`，会规范地生成 patch 文件，重装也能复现

---

## 十三、总结：一句话记忆与一句话延伸

**记忆**：硬链接给同一个 inode 起多个名字（共享内容）；符号链接是写着"去那边找"的纸条（间接路由）。

**延伸**：pnpm 用硬链接做内容去重（同样的字节只存一份），用符号链接做结构组织（每个包看到自己需要的依赖树）。两种工具组合起来，同时解决了"磁盘占用"和"幽灵依赖"两个 npm 时代的顽疾。

更宏观地说：**Unix 文件系统设计的核心思想是"分离"**——名字与身份分离、引用与存储分离、路径解析与对象访问分离。pnpm 不是发明了新东西，它只是把这套分离哲学用得淋漓尽致。理解了这一层，你再看 Docker overlayfs、Git 的对象数据库、容器存储驱动，会发现它们全是同一种思路的变体。这就是基础知识的复利。
