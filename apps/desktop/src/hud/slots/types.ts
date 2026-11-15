/** 格子图标，状态图标与快捷栏图标共用 */
export interface SlotIcon {
  image: HTMLImageElement;
  /** 文件图标平滑缩放，缺失占位图走最近邻 */
  smooth: boolean;
}
