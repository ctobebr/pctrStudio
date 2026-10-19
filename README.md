# PTCR Studio（点云全景工作台）

桌面端点云数据处理与可视化应用：导入手机端（scan Android App）采集的数据（文件夹或 zip 数据包），
调用外部算法程序 gpd.exe 生成各站位点云与全景照片（多站位时自动拼接），并在本机渲染查看。

## 功能

- **导入项目**：直接选择含原始数据的文件夹（原地引用，不复制数据），或选择手机端分享的 zip（自动解压到 workspace 后登记）
- **算法处理**：调用外部 gpd.exe，单命令完成「每站点云/全景生成 + 多站拼接」；日志实时转发到工作台，支持中途取消
- **产物发现式扫描**：不依赖算法输出的具体文件名，按规则自动发现各站点云、全景照片与拼接点云（规则集中在 `artifactScanner.cjs`）
- **点云渲染**：Three.js 大点云渲染（千万点级），按高度着色
- **全景查看**：球面全景查看器，逐站查看生成的全景照片
- **磁盘目录树**：工作台左侧按磁盘原样展示数据结构，目录树中的点云文件可点击直接渲染

## 目录结构

```
E:\ptcr-studio\
├─ apps\desktop\            # Electron 桌面应用（Vue3 + Three.js）
│   ├─ src\                 # 渲染进程（Vue 界面、Three.js 点云/全景渲染）
│   ├─ electron\            # 主进程（IPC、管线编排、项目登记、产物扫描）
│   │   └─ services\        # pipeline（gpd.exe 调用）/ artifactScanner（产物发现）/ projectStore（项目索引）等
│   ├─ scripts\             # dev / dist:win 启动与打包脚本
│   ├─ electron-builder.yml # 打包配置（npm run dist:win）
│   └─ release\             # 打包产物（不入库）
├─ docs\                    # 开发指南.md（开发全流程）、TODO.md（待办与待确认事项）
├─ workspace\               # 项目索引（projects.json）与 zip 解压目录（运行时生成，不入库）
└─ .gitignore
```

## 快速开始

### 1. 环境准备（一次性）

- **Node.js** ≥ 18（运行 Electron 应用）
- **算法程序 gpd.exe**：外部交付件，不随本仓库分发。从算法侧获取后放到本机任意目录，
  首次使用时在应用「设置」页指定其路径即可（路径持久化在 settings.json）。

### 2. 启动应用

```powershell
cd E:\ptcr-studio\apps\desktop
npm install
npm run dev        # 开发模式
```

生产构建：

```powershell
npm run build      # 构建渲染进程
npm run start      # 以生产模式启动 Electron
```

### 3. 打包发布给同事（交付）

```powershell
cd E:\ptcr-studio\apps\desktop
npm run dist:win   # 构建前端 + Electron 运行时，产出安装包（约 90MB）
```

> 该命令实际执行 `scripts\dist-win.cjs`，已内置 npmmirror 下载镜像，国内网络直连 GitHub 失败的问题自动规避。

产物在 `apps\desktop\release\`：

| 文件 | 用途 |
|---|---|
| `PTCR-Studio-Setup-<版本号>.exe` | **发这个给同事**：双击安装（可选目录、建快捷方式），覆盖安装即升级 |
| `win-unpacked\PTCR Studio.exe` | 免安装版，双击直接运行（本机自测用） |

安装包自带 Electron/Node 运行时，**同事无需装 Node.js**，一次性准备仅需：

1. 从算法侧获取 **gpd.exe** 放到本机
2. 应用「设置」页指定 gpd.exe 路径（也可按需修改 workspace 数据目录）

**更新规则**：改了任意代码（前端 / 主进程）→ 重跑 `npm run dist:win` → 把新 Setup exe 发给同事覆盖安装。
算法端更新只需替换同事机器上的 gpd.exe 并在设置页确认路径，无需重新打包桌面端。

打包后应用的数据位置：项目索引、设置与 workspace 在 `%APPDATA%\PTCR Studio\`（安装目录只读）。

### 4. 使用流程

1. 首页点击「导入项目」，选择含各站位原始数据的文件夹（如内含 `Batch_001、Batch_002…`）或 zip 数据包
2. 进入工作台，点击右上角「运行算法」（调用 gpd.exe），日志实时显示在底部面板；运行中可「取消」
3. 完成后自动重扫产物：
   - 左侧目录树按磁盘原样浏览数据，点云文件可点击渲染
   - 右侧双栏查看各站位照片与点云（按高度着色），多站位时可见拼接合并点云
   - 「重新扫描」可随时手动刷新产物

## 算法接入说明

### gpd.exe 调用契约

- 命令：`gpd.exe produce --path <项目数据根>`（调用逻辑见 `apps/desktop/electron/services/pipeline.cjs`）
- 工作目录设为 exe 所在目录（gpd 可能按自身所在目录定位资源）
- 单命令覆盖全部处理：每站点云/全景生成 + 多站位自动拼接，输出直接落在数据根目录内

### 产物发现（与算法输出解耦）

应用不硬编码算法输出的文件/目录命名，扫描规则集中在 `apps/desktop/electron/services/artifactScanner.cjs` 顶部 `RULES`：

- 站位目录名模式（现状 `Batch_NNN`，无匹配时回退为全部一级子目录）
- 点云产物扩展名（`.ply`）、全景照片扩展名（`.png/.jpg/.jpeg`）
- 站内输出目录提示词（`pctr_output / output / result / pano`，宽松匹配）
- 原始输入点云前缀（`pointCloud_data_*.txt`）、拼接点云扫描深度等

算法输出命名变化时只需调整 `RULES`，无需改动管线代码。

## 后续算法替换

- **更换算法程序**：保持 CLI 契约 `gpd.exe produce --path <root>` 即可直接替换（或在设置页指向新程序）；
  输出命名若变更，同步调整 `artifactScanner.cjs` 的 `RULES`
- **算法参数配置化**（如同事后续提供的 JSON 配置文件）：详见 `docs/TODO.md`

开发调试、测试与发布细节见 `docs/开发指南.md`。
