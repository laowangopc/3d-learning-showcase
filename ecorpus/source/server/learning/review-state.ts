import { LearningError, textField } from './validation.js';

export function reviewState(published:boolean, row?:any) {
  return published ? 'published' : row?.state === 'pending' || row?.state === 'changes' ? row.state : 'draft';
}
export function reviewTransition(state:string, action:string, input:any, administrator:boolean) {
  if (action === 'submit') {
    if (!['draft','changes'].includes(state)) throw new LearningError(409,'资源状态已变化，请刷新后再提交。');
    if (input.license === 'unknown') throw new LearningError(400,'请先编辑资源说明，补充明确的许可后再提交。');
    if (input.confirmed !== true) throw new LearningError(400,'请确认允许核对后公开浏览和下载。');
    return {state:'pending',message:''};
  }
  if (action === 'withdraw') {
    if (state !== 'pending') throw new LearningError(409,'此资源已不在等待审核，请刷新查看最新结果。');
    return {state:'draft',message:''};
  }
  if (action === 'reject') {
    if (!administrator) throw new LearningError(403,'只有管理员可以退回资源。');
    if (state !== 'pending') throw new LearningError(409,'此资源已不在等待审核，请刷新查看最新结果。');
    return {state:'changes',message:textField(input.message,'修改建议',1000,true)};
  }
  throw new LearningError(400,'请选择提交、撤回或退回修改。');
}
