// Crag 工作區各檔共用的 DOM 小工具
export const $ = (s) => document.querySelector(s);
export const el = (tag, { dataset, ...props } = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  if (dataset) Object.assign(e.dataset, dataset);
  e.append(...kids);
  return e;
};
