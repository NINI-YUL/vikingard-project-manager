import {calendarHours,dayOf,terminal} from './management-engine.mjs';

// Plans are date-based: include both endpoint days using the company calendar.
export function plannedProgress(start,end,at,calendar={}) {
  const first=dayOf(start),last=dayOf(end),stamp=at==null?NaN:new Date(at).getTime();
  if(!first||!last||first>last||!Number.isFinite(stamp))return null;
  const from=first+'T00:00:00+08:00',to=last+'T23:59:59.999+08:00';
  try {
    const total=calendarHours(from,to,calendar);
    if(total<=0)return null;
    if(stamp<=new Date(from).getTime())return 0;
    if(stamp>=new Date(to).getTime())return 100;
    return Math.min(100,Math.max(0,calendarHours(from,new Date(stamp),calendar)/total*100));
  } catch { return null; }
}

export function feedbackRisk(item,feedback,calendar={},now=new Date()) {
  const unknown=reason=>({level:'unknown',reason,feedback:null});
  if(item.kind!=='professional')return null;
  if(item.sourcePresence!=='current'||!item.semantic||item.feedbackEligible===false)return unknown('来源、结构、职能或状态映射待核对');
  if(terminal(item.semantic))return {level:'normal',reason:'工单已结束，无当前反馈风险',feedback:null};
  if(feedback?.state!=='valid')return unknown(feedback?.state==='review'?'反馈冲突待复核':'尚无通过当前资格校验的有效反馈');
  const submittedAt=feedback.submitted_at,progress=feedback.progress_percent;
  if(submittedAt==null||!Number.isFinite(new Date(submittedAt).getTime())||new Date(submittedAt)>now||!Number.isInteger(progress)||progress<0||progress>100||!['进度正常','存在风险'].includes(feedback.situation))return unknown('反馈内容或提交时间不可判断');
  const plan=plannedProgress(item.plannedStartAt,item.plannedDueAt,submittedAt,calendar);
  const lag=plan==null?null:Math.max(0,plan-progress);
  const result={feedback:{progressPercent:progress,submittedAt,situation:feedback.situation,note:feedback.note},plannedProgressPercent:plan,lagPercentagePoints:lag,thresholdPercentagePoints:20};
  if(feedback.situation==='存在风险')return {...result,level:'high',reason:'有效表单反馈：存在风险'};
  if(plan==null)return {...result,level:'unknown',reason:'计划时间缺失、倒置或没有有效工作时段，无法比较进度'};
  // Compare unrounded percentages. Display rounding must not change the threshold.
  return {...result,level:lag>=20?'watch':'normal',reason:lag>=20?'反馈落后提交时的计划进度达到20个百分点':'反馈落后未达到20个百分点'};
}

export function summarizeRisk(items) {
  const counts={high:0,watch:0,normal:0,unknown:0};
  for(const item of items)counts[item.risk?.level??'unknown']++;
  const level=counts.high?'high':counts.watch?'watch':counts.unknown||!items.length?'unknown':'normal';
  return {level,...counts,total:items.length};
}
