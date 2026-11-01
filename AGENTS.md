# NJZ 飞越冬夜

这是独立的 React + Vite + TypeScript 飞行游戏；入口为 `App.tsx`、`components/FlightGame.tsx`。旧音乐播放器及其主题、歌词、接口、工具已移除，不要重新引入。

- 使用中文交流；修改前阅读相关源码和 `docs/` 的关卡约束。
- 原角色帧和城市场景位于 `NJZPowerpuffGirls/`，保持原图与五帧动画。所有静态位图使用 WebP；像素图转换采用无损编码。结算分享 PNG 是运行时输出。
- 完整 Cubic 11 已无损压为 `public/fonts/Cubic_11.woff2`，保留全部字形，禁止裁字导致缺字；保留两份字体授权。
- 世界始终完整展示720高，手机只放大实体1.5倍，不缩放整个Canvas、不跟随镜头。手机竖持用CSS旋转，画布读取 `clientWidth/clientHeight`，触控判断使用粗指针。Pad/桌面布局不改。
- 保留关卡的原路线、节拍、分支、猪和斜管；调整片段后运行全部测试，包含696个手机变体和300局随机编排。
- 交付前运行 `npm run typecheck`、`npm run build`；相关玩法变化运行 `npm test`。资源改动需在浏览器检查首页、开始/暂停和成功/失败结算。
- 开发服务使用 `npm run dev -- --host 0.0.0.0`；交付本机当前局域网IP、端口及可点击URL。
- `deploy/publish.sh` 仅发布本游戏，通过已有SSH别名操作 `/var/www/njzfly/`。Nginx独立配置为 `deploy/njzfly.nginx`，保留服务器其他站点。
- GitHub仓库为 `yaohermionewei/njz-fly`。不提交 `node_modules/`、`dist/`、`.env*`、浏览器档案、临时截图或旧播放器历史。
