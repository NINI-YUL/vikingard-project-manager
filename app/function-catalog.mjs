export const functions=['UI界面','UI图标','美术','动效','数值','客户端','服务端','KGUI','后台'];
export const foundationFunctions=['UI界面','美术','数值','客户端','服务端','KGUI'];
export const detailFunctions=['UI图标','动效','后台'];
export const legacyFunctions=['UI'];
export const functionResolution={confirmed:'已确认',legacy_unresolved:'旧值待配置',unrecognized:'来源值待配置',missing:'未填写'};
export function resolveFunction(value){
  if(value==null||String(value).trim()==='')return {resolution:'missing',issue:null};
  const name=String(value).trim();
  if(functions.includes(name))return {resolution:'confirmed',issue:null};
  if(legacyFunctions.includes(name))return {resolution:'legacy_unresolved',issue:'legacy_function_unresolved'};
  return {resolution:'unrecognized',issue:'unknown_function_value'};
}
export function functionIssue(value){return resolveFunction(value).issue;}
