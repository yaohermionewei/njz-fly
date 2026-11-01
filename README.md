# NJZ 飞越冬夜

NJZ 飞越冬夜是一个 React + Vite 像素风飞行游戏：跟随音乐在夜间城市中飞行，收集应援棒、躲避水管、击退方猪，并在移动端横屏体验完整关卡。

## 开发

```bash
npm install
npm run dev -- --host 0.0.0.0
```

生产构建与测试：

```bash
npm run build
node --test tests/*.mjs
```

构建产物位于 `dist/`，线上站点为 `njzfly.wystudio.zone`。服务器部署配置见 `deploy/njzfly.nginx`。

## 调试入口

- `?segments`：关卡片段目录
- `?bar=36`：从指定小节开始
- `?health=1`：一颗心测试失败结算
- `?power=1`：直接进入无敌模式
- `?flower`：从第一朵太阳花前开始
- `?member=0-4`：指定开局成员

## 目录

- `components/FlightGame.tsx`：游戏循环、输入、碰撞和收集
- `components/levelSegments.ts`：关卡片段与导演
- `components/gameArt.ts`、`components/pipeArt.ts`：像素美术
- `components/ResultModal.tsx`、`components/resultCardArt.ts`：结算与分享卡
- `NJZPowerpuffGirls/`：游戏场景和角色 WebP 素材
- `public/fonts/`：Cubic 11 与 Pixel Operator 字体及授权文件

仓库中的静态位图统一使用 WebP；分享按钮生成的图片是运行时导出的临时文件，不作为静态素材提交。
