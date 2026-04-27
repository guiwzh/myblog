# 我的博客 - 5 分钟上线指南

一个基于 **Hexo + Butterfly + Vercel** 的极简博客。日常用法：把 md 文件丢进 `source/_posts/`，git push，30 秒后自动上线。

---

## 一、第一次本地启动（一次性）

### 1. 装好 Node.js

去 [nodejs.org](https://nodejs.org) 下载并安装 LTS 版本（推荐 20.x 或更新）。安装后打开终端运行下面命令检查：

```bash
node -v   # 应该显示 v18 或更高
npm -v
```

### 2. 安装依赖

在项目根目录运行：

```bash
npm install
```

会下载 Hexo、Butterfly 主题等依赖到 `node_modules/`，第一次大概要 1-2 分钟。

### 3. 本地预览

```bash
npm run server
```

浏览器打开 http://localhost:4000 就能看到博客。修改文章/配置后会自动刷新。

按 `Ctrl+C` 退出。

---

## 二、改成你自己的信息

打开 `_config.yml`，修改最上面这几行：

```yaml
title: 我的博客              # 改成你的博客标题
subtitle: '记录想法与日常'    # 副标题
description: '...'           # 一句话描述
author: 你的名字             # 改成你
url: https://example.com    # 部署后再回来填实际网址
```

打开 `_config.butterfly.yml`，修改：

- `social:` 下面的 GitHub / Email 等链接
- `aside.card_announcement.content` 公告语
- `aside.card_author.button.link` 头像下的关注链接

打开 `source/about/index.md`，写自己的简介。

---

## 三、日常发文流程

### 方式 A：用命令（推荐，会自动套模板）

```bash
npx hexo new "我的新文章"
```

会在 `source/_posts/` 生成一个带好 front matter 的 `我的新文章.md`，直接编辑内容就行。

### 方式 B：直接拖 md 文件进去

把任何 md 文件放到 `source/_posts/` 目录下即可。开头加上这段元数据：

```yaml
---
title: 文章标题
date: 2026-04-28 10:00:00
tags: [标签一, 标签二]
categories: [分类]
---

正文内容...
```

### 推送上线

```bash
git add .
git commit -m "新文章"
git push
```

完事。Vercel 监听到推送后会自动构建并部署，约 30 秒上线。

---

## 四、第一次部署到公网

### 1. 推到 GitHub

在 [github.com](https://github.com) 创建一个新仓库（叫什么都行，比如 `myblog`），**不要**勾选 Initialize with README。

然后在本地项目根目录：

```bash
git init
git add .
git commit -m "初始化博客"
git branch -M main
git remote add origin https://github.com/你的用户名/myblog.git
git push -u origin main
```

### 2. 连接 Vercel

1. 打开 [vercel.com](https://vercel.com)，用 GitHub 账号登录。
2. 点 **Add New → Project**。
3. 选刚才创建的 `myblog` 仓库，点 **Import**。
4. Framework Preset 选 **Other**（项目里的 `vercel.json` 已经配好构建命令了）。
5. 点 **Deploy**。

约 1 分钟后会得到一个 `xxx.vercel.app` 的网址，可以直接打开访问。

### 3. 把网址写回 `_config.yml`

把 Vercel 给的网址填到 `_config.yml` 的 `url:` 字段，然后再 push 一次：

```bash
git add _config.yml
git commit -m "更新 url"
git push
```

---

## 五、（可选）绑定自己的域名

1. 在域名服务商（Namecheap、阿里云、Cloudflare 等）买一个域名。
2. Vercel 项目 → **Settings → Domains** → 输入你的域名 → 按提示添加 DNS 记录。
3. 等几分钟生效。
4. 把 `_config.yml` 里的 `url:` 改成新域名。

> **国内访问注意**：如果域名 DNS 在国内（万网、腾讯云等），Vercel 默认 IP 国内访问可能慢。可以把域名 DNS 转到 Cloudflare 加速，或改用 Cloudflare Pages 部署。

---

## 六、目录结构速查

```
myblog/
├── _config.yml             # Hexo 主配置（站点信息、URL、目录等）
├── _config.butterfly.yml   # Butterfly 主题配置（导航、侧栏、颜色等）
├── package.json            # Node 依赖
├── vercel.json             # Vercel 部署配置
├── scaffolds/              # 新文章模板
├── source/
│   ├── _posts/             # ★ 你写的文章都放这里 ★
│   └── about/index.md      # 关于页面
└── public/                 # 构建产物（自动生成，不进 git）
```

**90% 的时间你只需要碰 `source/_posts/` 这一个目录。**

---

## 七、常见问题

**Q: 想换主题颜色 / 字体 / 头像怎么办？**
改 `_config.butterfly.yml`，所有视觉相关的配置都在这。改完本地 `npm run server` 看效果，满意了再 push。

**Q: 文章怎么置顶？**
在 front matter 里加 `top: true`。

**Q: 怎么加评论？**
打开 `_config.butterfly.yml`，找到 `comments.use:`，填写 `Twikoo` 或 `Waline` 或 `Giscus` 等任一。具体配置见 [Butterfly 文档](https://butterfly.js.org/posts/ceeb73f/#评论系统)。

**Q: 想存草稿不发布？**
```bash
npx hexo new draft "草稿标题"
```
草稿会放在 `source/_drafts/`，不会被构建。完成后用 `npx hexo publish "草稿标题"` 移到 `_posts/`。

**Q: 构建报错？**
最常见的是改了配置文件 yml 缩进出错。yml 对缩进非常敏感，必须用空格不能用 tab。本地 `npm run server` 报什么错就改什么。

**Q: Vercel 构建失败？**
在 Vercel 项目页面点对应的 deployment → 看 Build Logs。通常是依赖问题，可以试试在本地删掉 `node_modules` 和 `package-lock.json`，重新 `npm install`，跑通后再 push。

---

写作愉快 ✍️
