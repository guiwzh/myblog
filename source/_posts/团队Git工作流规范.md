---
title: Git 协作的体面之道：从分支策略到上线流程的工程化实践
date: 2026-05-22 14:00:00
tags:
  - Git
  - 团队协作
  - 工作流
  - 工程化
  - 代码评审
categories:
  - 工程实践
description: 一份可直接落地的团队 Git 协作手册——从分支模型选型、命名规范、Conventional Commits，到日常开发流程、Pull Request、Code Review、Hotfix 与 Tag/Release，串起「让主干永远可发布」的完整方法论，并讲清每条规则不照做会踩什么坑。
cover: https://picsum.photos/seed/team-git-workflow/800/450
---

> 一份可直接落地的团队协作规范。目标不是"列规则",而是讲清楚每个环节**怎么做、为什么这么做、不这么做会踩什么坑**。可整体采用,也可按团队规模裁剪。

---

## 0. 总体目标与原则

一套好的工作流要同时满足三件事:

- **主干永远可发布(可部署)** —— 任何时刻从主干切出来的代码都能编译、能跑、能上线。
- **改动可追溯** —— 任何一行代码都能回答"谁、什么时候、为了什么改的"。
- **协作低摩擦** —— 多人并行开发时,冲突少、合并快、回滚容易。

围绕这三点,后面所有的规则都是手段而非目的。当某条规则和这三个目标冲突时,以目标为准。

---

## 1. 分支模型:三选一

没有"最好的"模型,只有"最适合你团队节奏的"模型。下面三种从轻到重排列。

### 1.1 Trunk-Based Development(主干开发,适合成熟团队 / 高频部署)

所有人直接在 `main` 上协作,功能分支生命周期极短(几小时到一两天),频繁合回。未完成的功能用 **Feature Flag(功能开关)** 隐藏,而不是用长期分支隔离。

```
main ─●─●─●─●─●─●─●──►  (持续合入,持续部署)
       └─┘ └─┘ └─┘
       极短命的分支,当天就合回
```

- **优点**:集成成本最低,几乎没有"合并地狱";最适合 CI/CD 持续交付。
- **代价**:要求强测试覆盖、强自动化、团队纪律高,且需要 Feature Flag 基础设施。
- **适用**:工程能力成熟、追求快速迭代的团队。

### 1.2 GitHub Flow(推荐:中小团队 / 持续部署)

只有一个长期分支 `main`。所有改动从 `main` 切短期分支,完成后通过 PR 合回,合回即可部署。

```
main (永远可部署)
 ├── feature/user-login
 ├── fix/payment-bug
 └── feature/export-pdf
```

- **优点**:简单、易理解、适合频繁发布,心智负担低。
- **代价**:没有专门的"发布准备期",不适合需要长时间冻结测试的版本化交付。
- **适用**:大多数 Web 应用 / SaaS 团队的默认选择。

### 1.3 Git Flow(适合有明确版本周期 / 需要并行维护多版本)

两条长期分支 + 三类临时分支,角色分工明确。

```
main      生产环境,只接受 release / hotfix 合入,每次合入打 tag
develop   集成分支,日常开发的汇聚点
feature/* 功能开发,从 develop 切出 → 合回 develop
release/* 发布准备,从 develop 切出 → 测试修复后合入 main 和 develop
hotfix/*  线上紧急修复,从 main 切出 → 合回 main 和 develop
```

- **优点**:版本管理严谨,支持"一边发布 v2、一边维护 v1"的并行场景。
- **代价**:分支多、流程重,`develop` 和 `main` 容易长期分叉,对持续部署不友好。
- **适用**:有版本号、有发布周期的客户端 / SDK / 需要长期支持多版本的产品。

### 选型建议

| 团队情况 | 推荐模型 |
|---|---|
| 创业团队 / Web 应用 / 想频繁上线 | GitHub Flow |
| 工程成熟 / 已有 CI/CD 和 Feature Flag | Trunk-Based |
| 客户端 / SDK / 需要同时维护多个发布版本 | Git Flow |

**一旦选定,全团队统一。** 混用模型是混乱的最大来源。本文后续以 **GitHub Flow** 为主线举例,Git Flow 的差异会单独标注。

---

## 2. 分支命名规范

| 类型 | 命名格式 | 示例 |
|---|---|---|
| 功能 | `feature/简短描述` | `feature/oauth-login` |
| 缺陷修复 | `fix/简短描述` | `fix/null-pointer-checkout` |
| 线上紧急修复 | `hotfix/简短描述` | `hotfix/payment-timeout` |
| 重构 | `refactor/简短描述` | `refactor/order-service` |
| 文档 | `docs/简短描述` | `docs/api-readme` |
| 试验性 | `experiment/简短描述` | `experiment/new-cache` |

**约定**:

- 全小写,用连字符(`-`)分词,不用下划线或空格。
- 关联工单时把工单号放前面:`feature/JIRA-123-oauth-login`,方便工具自动联动。
- 名字要让人**不点开就知道在做什么**,避免 `feature/fix`、`feature/test2` 这种黑话。
- 分支是短期的,合并后及时删除,保持分支列表干净。

---

## 3. 提交信息规范(Conventional Commits)

清晰的提交历史本身就是文档。采用 [Conventional Commits](https://www.conventionalcommits.org) 规范,还能让工具自动生成 CHANGELOG、自动决定版本号。

### 3.1 格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 3.2 常用 type

| type | 含义 | 是否影响版本号 |
|---|---|---|
| `feat` | 新功能 | MINOR +1 |
| `fix` | 修复 bug | PATCH +1 |
| `docs` | 仅文档变更 | 无 |
| `style` | 格式调整(空格、分号,不影响逻辑) | 无 |
| `refactor` | 重构(非新功能、非修 bug) | 无 |
| `perf` | 性能优化 | PATCH +1 |
| `test` | 测试相关 | 无 |
| `build` | 构建系统 / 外部依赖变更 | 无 |
| `ci` | CI 配置变更 | 无 |
| `chore` | 其它杂项(不改源码和测试) | 无 |

### 3.3 各部分要点

- **subject(标题行)**:祈使句("添加"而非"添加了"),不超过 50 字,结尾不加句号。把它想象成在补全 "If applied, this commit will ___"。
- **body(正文)**:解释**为什么**这么改、背景是什么,而不是复述代码做了什么(代码本身已经说明了"怎么做")。每行不超过 72 字。
- **footer(脚注)**:关联工单(`Closes #234`);破坏性变更必须写 `BREAKING CHANGE: <说明>`,这会触发 MAJOR 版本号 +1。

### 3.4 示例

```
feat(auth): 支持微信扫码登录

接入微信开放平台 OAuth2。此前只支持手机号登录,海外和
PC 端用户转化率偏低,扫码登录可降低注册门槛。

新增 WechatAuthService 处理授权回调。

Closes #234
```

破坏性变更示例:

```
refactor(api): 统一用户接口返回结构

将 /user 系列接口的返回体由扁平结构改为 { code, data, msg }
包裹结构,与其它模块对齐。

BREAKING CHANGE: /user/* 接口返回结构变更,前端需同步调整解析逻辑。
```

---

## 4. 日常开发流程(逐步操作)

这是开发者每天实际要走的路径,以 GitHub Flow 为例。

### 第 1 步:同步主干,切出分支

```bash
git checkout main
git pull --rebase origin main          # 保持本地 main 与远端一致
git checkout -b feature/oauth-login     # 从最新 main 切出功能分支
```

### 第 2 步:开发,小步提交

```bash
# 写代码……
git add -p                              # 分块审视后再暂存,避免误提交
git commit -m "feat(auth): 添加微信授权回调骨架"
# 继续写……
git commit -m "feat(auth): 实现 token 换取与用户绑定"
```

**小步提交的价值**:每个提交是一个"可理解的最小逻辑单元",出问题时能用 `git bisect` 精确定位,回滚也更可控。不要憋一整天写一个巨型提交。

### 第 3 步:频繁推送

```bash
git push -u origin feature/oauth-login
```

每天结束前至少推送一次。本地的代码对团队不可见、不可备份,推到远端才安全。

### 第 4 步:开发期间保持与主干同步(关键)

主干在你开发期间会被别人合入新代码。**越晚同步,冲突越大、越难解。** 建议每天同步一次:

```bash
git fetch origin
git rebase origin/main                  # 把你的提交"重放"到最新 main 之上
```

为什么用 `rebase` 而不是 `merge`?见第 5 节。

### 第 5 步:提 PR(见第 6 节)

### 第 6 步:合并后清理

```bash
git checkout main
git pull --rebase origin main
git branch -d feature/oauth-login       # 删本地分支
git push origin --delete feature/oauth-login   # 删远端分支(若平台未自动删)
```

---

## 5. 同步主干:Rebase vs Merge(讲透"为什么")

这是新人最容易困惑、也最容易出事的地方。

### 5.1 两者的区别

假设你从 C2 切出分支做了 A、B 两个提交,期间 main 多了 C3:

**Merge** —— 制造一个"合并提交"把两条线汇合:

```
main:    C1─C2─────────C3─┐
                          M  ← merge commit
feature:      └─A─B──────┘
```

历史**真实但分叉**,多人协作时图谱会变成"意大利面"。

**Rebase** —— 把你的 A、B "摘下来",重新接到 C3 之后:

```
main:    C1─C2─C3
feature:          └─A'─B'   ← A、B 被重写为 A'、B'
```

历史**线性、干净**,像是你一直基于最新代码在开发。

### 5.2 用哪个?——黄金法则

> **私有分支(只有你在用)→ 用 rebase 保持线性。**
> **共享分支(别人也基于它工作)→ 永远不要 rebase。**

原因:rebase 会**重写提交(改变 commit hash)**。如果别人已经基于你的旧提交工作,你一 rebase,对方的历史就和你对不上了,再 push 会互相覆盖,引发灾难性混乱。

所以:
- 在自己的 `feature/*` 分支上 `git rebase origin/main` —— ✅ 安全,推荐。
- 在 `main` / `develop` 等共享分支上 rebase —— ❌ 绝对禁止。
- `git pull` 默认会产生 merge commit,改用 `git pull --rebase`(或全局配置 `git config --global pull.rebase true`)让拉取也保持线性。

### 5.3 Rebase 后推送

rebase 重写了历史,本地和远端分支会"分叉",直接 push 会被拒绝。用:

```bash
git push --force-with-lease
```

**不要用 `--force`**。`--force-with-lease` 会先检查远端分支没有你不知道的新提交,若有则拒绝推送,防止覆盖掉队友刚推上去的代码。`--force` 则是无脑覆盖,危险。

---

## 6. Pull Request / 合并请求规范

PR 是代码进入主干的唯一闸门,也是知识共享和质量把关的核心环节。

### 6.1 一个好的 PR 应该

- **单一职责**:只做一件事。"顺手改了个无关的格式"会让评审者难以聚焦。
- **体量可控**:建议变更行数 < 400 行。研究和经验都表明,超过这个量评审质量会断崖式下降——评审者会从"逐行看"退化成"大致扫一眼然后 LGTM"。改动大就拆成多个 PR。
- **标题遵循提交规范**,描述里写清:**背景**(为什么做)、**方案**(怎么做的、有哪些取舍)、**影响范围**、**测试情况**(怎么验证的)。
- **关联工单**。
- **通过 CI**(构建 + 测试 + Lint)后才允许合并。
- **至少 1 名 reviewer 批准**;核心 / 高风险改动要求 2 名。

### 6.2 PR 描述模板

```markdown
## 背景 / 动机
<为什么需要这个改动,关联什么问题>

## 改动方案
<做了什么,关键设计取舍>

## 影响范围
<涉及哪些模块,是否有破坏性变更,是否需要数据迁移 / 配置变更>

## 测试情况
- [ ] 单元测试已补充并通过
- [ ] 本地手动验证:<步骤>
- [ ] 是否需要灰度 / 回归

## 关联工单
Closes #___
```

### 6.3 合并策略(三选一,团队统一)

| 策略 | 效果 | 适用 |
|---|---|---|
| **Squash and merge(推荐)** | 整个 PR 压成一个提交进主干 | 想要干净线性的主干历史。代价是丢失 PR 内部的分步提交 |
| **Rebase and merge** | 保留每个提交,线性接入,无 merge commit | 希望保留分步提交且不要 merge commit |
| **Create a merge commit** | 完整保留分支历史 + 一个 merge commit | 需要完整追溯分支演进的场景 |

**关于"squash 后还能不能追溯原始提交"**:能,但要靠平台而非本地仓库。被 squash 的原始提交不会进入主干历史;只要原分支还在,这些提交仍然可达。但**原分支一旦删除,它们在本地就变成"游离对象",最终会被 `git gc` 回收(默认约两周后),不能长期依赖**。可靠的追溯途径是 **PR 页面**——GitHub / GitLab 会永久保留该 PR 的完整 commit 列表。所以日常追溯看 PR 即可,别指望从本地仓库捞回来。

---

## 7. 代码评审准则

### 7.1 评审者(Reviewer)应关注

按重要性排序:**功能正确性 → 边界条件与异常处理 → 安全隐患 → 测试覆盖 → 可读性与可维护性 → 性能影响**。

**不要纠结主观风格**(缩进、命名偏好、引号种类)——这些交给 Linter / Formatter 自动处理,人去争论是浪费精力且伤感情。

### 7.2 评审礼仪

- **对事不对人**。说"这个函数"而不是"你这个函数"。
- 用**建议**而非命令语气:"这里用 Map 是不是会更清晰?" 优于 "改成 Map"。
- 区分**阻塞性意见**和**可选建议**。可以用前缀标注,如 `nit:`(吹毛求疵,可不改)、`question:`(只是想确认)、`blocking:`(必须解决才能合)。
- 评审是协作不是审判,目标是让代码更好,不是证明谁更厉害。

### 7.3 提 PR 者应做到

- **先自评一遍再请人看**。很多低级问题自己就能发现。
- 主动在容易引起疑问的地方留下解释性注释,降低评审者的理解成本。
- **及时回应**评论;采纳的就改,不采纳的就说明理由,别让评论悬而不决。

---

## 8. 版本发布与 Tag

### 8.1 语义化版本(SemVer)

遵循 [SemVer](https://semver.org):`主版本.次版本.修订号`(MAJOR.MINOR.PATCH)

- **MAJOR**:不兼容的 API 变更(对应 `BREAKING CHANGE`)。
- **MINOR**:向下兼容的新功能(对应 `feat`)。
- **PATCH**:向下兼容的问题修复(对应 `fix`、`perf`)。

预发布版本用后缀:`v2.0.0-beta.1`、`v2.0.0-rc.1`。

### 8.2 打 Tag 并发布

```bash
git tag -a v1.2.0 -m "支持批量导出功能"
git push origin v1.2.0
```

**用带注释的 tag(`-a`)而不是轻量 tag**:带注释 tag 是一个完整的 Git 对象,记录了打 tag 的人、时间和说明,适合正式发布;轻量 tag 只是个指针,适合临时标记。

### 8.3 Git Flow 的发布流程(若采用)

```bash
# 1. 从 develop 切出 release 分支,进入"封版测试期"
git checkout -b release/1.2.0 develop

# 2. 在 release 分支上只修 bug、改版本号、补文档,不加新功能

# 3. 测试通过后,合入 main 并打 tag
git checkout main
git merge --no-ff release/1.2.0
git tag -a v1.2.0 -m "Release 1.2.0"

# 4. 同时合回 develop(否则封版期的修复会丢失)
git checkout develop
git merge --no-ff release/1.2.0

# 5. 删除 release 分支
git branch -d release/1.2.0
```

---

## 9. 真实工作中的疑难场景

这一节是规范文档里最常被忽略、却最常用到的部分。

### 9.1 线上紧急修复(Hotfix)

线上着火时,不要走完整功能流程。

GitHub Flow:从 `main` 切 `hotfix/*` 分支,修完走快速 PR 合回 `main`,立即部署并打 PATCH tag。

Git Flow:从 `main` 切 `hotfix/*`,修完同时合入 `main` **和** `develop`(关键!否则下个版本会把你刚修的 bug 又带回来)。

### 9.2 回滚一个已发布的版本

线上出问题需要紧急回退,有两种思路:

**方式一:`git revert`(推荐,不改写历史)**

```bash
git revert <bad-commit-hash>            # 生成一个"反向提交"抵消改动
# 若是一个 merge commit:
git revert -m 1 <merge-commit-hash>     # -m 1 表示保留第一父分支(主干)
```

`revert` 不删除历史,而是新增一个撤销提交,**对共享分支是安全的**。

**方式二:回退到上一个 tag 重新部署**

如果你的部署是基于 tag 的,最快的回滚往往是直接用上一个稳定 tag 重新部署,代码层面再从容 revert。

> ⚠️ **永远不要**用 `git reset --hard` + `force push` 去"回滚"共享分支,这会重写公共历史,毁掉所有人的本地状态。

### 9.3 把某个提交挑到别的分支(Cherry-pick)

比如某个修复在 `develop` 上,需要单独捡到 `release/1.2.0`:

```bash
git checkout release/1.2.0
git cherry-pick <commit-hash>
# 多个连续提交:
git cherry-pick <hash-A>^..<hash-B>
```

注意:cherry-pick 会**复制**出一个新提交(新 hash),如果之后两条分支又合并,可能产生重复提交。优先考虑能否通过正常合并解决,cherry-pick 用于确实只想要"那一个改动"的场景。

### 9.4 误提交了密钥 / 密码 / Token(高危!)

**第一时间做的事不是删 commit,而是立刻让那个密钥失效(吊销 / 轮换)。** 只要它进过 Git 历史,就必须假设已经泄露——即使你后来删了,clone 过的人本地都还有。

然后再清理历史:

```bash
# 推荐用 git-filter-repo(比老旧的 filter-branch 快且安全)
pip install git-filter-repo
git filter-repo --path config/secrets.yml --invert-paths

# 之后需要强制推送(这是少数必须 force push 的场景),并通知所有人重新 clone
```

> 注意:`git-filter-repo` 默认要求在**全新 clone 的仓库**上运行,否则会主动中止(可加 `--force` 跳过,但务必先确认无未提交改动);运行后它会自动移除 `origin` 远端,需要 `git remote add origin <url>` 重新关联再推送。

事后用 `.gitignore` 排除敏感文件,并在 CI 接入 secret 扫描(如 gitleaks、trufflehog)做兜底,防止再次发生。

### 9.5 大文件 / 二进制资源

Git 不擅长存储大的二进制文件(每次改动都会存一份完整副本,仓库迅速膨胀)。设计稿、视频、模型权重等用 **Git LFS**:

```bash
git lfs install
git lfs track "*.psd"
git add .gitattributes
```

### 9.6 Monorepo 的注意点

多个项目放一个仓库时:用 CODEOWNERS 划分各目录的负责人;CI 配置成"只跑受影响目录的测试"(路径过滤),否则改一行文档要等全量测试是不可接受的;提交和 PR 仍然按目录 / 模块保持单一职责。

---

## 10. 强制执行:别只靠自觉

规范靠人自觉执行 = 迟早形同虚设。用工具兜底。

### 10.1 分支保护规则(在 GitHub / GitLab 后台配置)

对 `main`(及 `develop`)开启:

- 禁止直接 push,**必须通过 PR**。
- 合并前必须通过指定的 CI 检查。
- 合并前必须有 N 个 approval。
- 要求分支与主干保持最新(up to date)再合并。
- 禁止 force push 和删除分支。

### 10.2 提交规范自动校验(本地 Git Hook)

用 `husky` + `commitlint` 在提交时自动拦截不合规的提交信息;用 `lint-staged` 在提交前只对暂存文件跑 Lint / Format,快且无遗漏。

> ⚠️ husky v9 起,旧的 `husky install` 写法和 `husky add` 命令已废弃,改为 `npx husky init` 初始化 + 手动创建钩子文件。下面是当前(v9+)的正确配置。

安装与初始化:

```bash
npm install --save-dev husky @commitlint/cli @commitlint/config-conventional lint-staged

npx husky init   # 创建 .husky/ 目录,并自动把 prepare 脚本写成 "husky"

# 写入 commit-msg 钩子:每次提交校验提交信息是否符合规范(这一步不能省,否则 commitlint 不会运行)
echo 'npx --no -- commitlint --edit "$1"' > .husky/commit-msg

# 写入 pre-commit 钩子:提交前对暂存文件跑 lint-staged
echo 'npx lint-staged' > .husky/pre-commit
```

```jsonc
// package.json(husky init 会自动写好 prepare 脚本)
{
  "scripts": { "prepare": "husky" },
  "lint-staged": {
    "*.{js,ts}": ["eslint --fix", "prettier --write"]
  }
}
```

```js
// commitlint.config.js
module.exports = { extends: ['@commitlint/config-conventional'] };
```

### 10.3 自动化发布

接入 `semantic-release`:它读取 Conventional Commits,自动决定版本号、打 tag、生成 CHANGELOG、发布——彻底消除"忘了升版本号"和"CHANGELOG 写得乱"的问题。

---

## 11. 几条铁律(可贴在 wiki 首页)

1. **不直接 push 到 `main` / `develop`**,一律走 PR。用分支保护强制执行。
2. **不提交敏感信息**(密钥、密码、token);误提交先吊销密钥,再清历史。
3. **小步提交,频繁推送**,避免大爆炸式合并。
4. **拉取用 rebase 保持线性**:`git pull --rebase`。
5. **私有分支可以 rebase,共享分支永远不要 rebase。**
6. **合并前先同步主干**,本地解决冲突,别把冲突带进主干。
7. **不在共享分支 force push**;私有分支确需要时用 `--force-with-lease`,不用 `--force`。
8. **PR 要小、要单一职责**,< 400 行变更。
9. **CI 不过,不合并。**
10. **删掉已合并的分支**,保持仓库整洁。

---

## 附录:常用命令速查

```bash
# 切分支
git checkout -b feature/xxx

# 暂存时分块审视
git add -p

# 同步主干(在私有 feature 分支上)
git fetch origin && git rebase origin/main

# rebase 后安全推送
git push --force-with-lease

# 撤销已发布的提交(安全)
git revert <hash>

# 撤销 merge commit
git revert -m 1 <merge-hash>

# 把某提交挑到当前分支
git cherry-pick <hash>

# 交互式整理本地提交(合并 / 改写,仅限未推送或私有分支)
git rebase -i HEAD~3

# 查看某行代码是谁、哪个提交引入的
git blame <file>

# 二分查找引入 bug 的提交
git bisect start
git bisect bad
git bisect good <hash>

# 临时保存未提交的改动
git stash
git stash pop
```
