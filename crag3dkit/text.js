// 名稱與難度的取法（跟 TopoKit 同一套規則；Kit 彼此獨立，不 import 別的 Kit，所以這兩個小函式各自一份）。
// English: pick a localised name and a grade from format v2 values (same rules as TopoKit's data.js; kits do not import each other).

const GRADE_SYSTEMS = ['yds', 'french', 'v', 'font', 'uiaa', 'british', 'dan'];

/** 名稱：字串直接用；物件依語言取，找不到就 zh-Hant、en、第一個 */
export function pickName(name, lang) {
  if (name == null || typeof name === 'string') return name;
  const keys = Object.keys(name);
  const hit = [lang, lang?.split('-')[0], 'zh-Hant', 'en'].find((k) => k && name[k]) ?? keys[0];
  return hit ? name[hit] : undefined;
}

/** 難度：props.grade 是 { 系統: 值 }；依 systems 的順序取第一個有的，沒有就取第一個 */
export function pickGrade(grade, systems = GRADE_SYSTEMS) {
  if (grade == null || typeof grade === 'string') return grade;
  const key = systems.find((s) => grade[s] != null) ?? Object.keys(grade)[0];
  return key ? String(grade[key]) : undefined;
}
