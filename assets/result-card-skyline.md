此背景从本项目 `NJZPowerpuffGirls/bottom1.webp`、`middle1.webp`、`top.webp` 合成，沿用已确认的 v9 竖版方案。

生成方式：`python3 .analysis/export_result_background.py`。保留原始素材，远景放大到 900×502，居中裁左右；中景和前景各 600×335，底边对齐。原云层按 600 宽移到顶部。

图片只包含天空、云层、场景和装饰星点；分享 PNG 的标题、五位成员、分数由 `resultCardArt.ts` 的 `drawResultCard` 绘制。

横版游戏弹窗使用同模块的 `drawResultModal`，不使用竖版场景图。其云彩为脚本同时导出的透明原素材层 `result-card-clouds.webp`；原有角色、字体、像素数字和计分时钟继续共用。

`result-card-gradient.webp` 是同一脚本导出的1×800天空色带。上段取分享卡天空延伸的原色，下段取原远景不含云和建筑的天空列，保留从深蓝到蓝紫的渐变。横版按自身高度缩放这条色带，避免使用另一套配色。
