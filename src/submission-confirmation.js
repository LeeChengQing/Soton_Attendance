export const SUCCESS_RULES = [
  ['en_answers_submitted', /\byour answers? have been submitted successfully\b/i],
  ['en_response_submitted', /\byour response (?:was|has been) submitted\b/i],
  ['en_response_recorded', /\byour response has been recorded\b/i],
  ['zh_response_submitted', /(?:(?:你的|您的)(?:响应|答复|回复)已(?:成功)?(?:提交|记录)|已(?:成功)?(?:提交|记录)(?:你的|您的)(?:响应|答复|回复))/i],
  ['ms_response_submitted', /(?:respons|jawapan)\s+(?:anda|awak)\s+(?:telah|sudah)\s+(?:dihantar(?:kan)?|direkodkan)/i],
  ['ms_thanks_submitted', /terima kasih[\s,，]*(?:respons|jawapan).*?(?:dihantar|direkodkan)/i]
];
export const FAILURE_RULES = [
  ['en_submission_error', /\b(?:something went wrong|server error|unable to submit|failed to submit)\b/i],
  ['zh_submission_error', /服务器(?:出错|错误)|提交失败|出了点问题/],
  ['ms_submission_error', /\b(?:ralat pelayan|sesuatu telah berlaku|gagal dihantar)\b/i]
];
// Populate only from redacted DOM captured on real successful Forms submissions.
// An empty table intentionally cannot supply the third structural vote.
export const SUCCESS_PAGE_SELECTORS = [];
export function isExplicitSuccess(text) {
  return SUCCESS_RULES.find(([,rule]) => rule.test(String(text || '')))?.[0] || null;
}
export function submissionSignals(before={},after={},options={}) {
  const failure=FAILURE_RULES.find(([,rule])=>rule.test(String(after.text || '')))?.[0];
  if(failure) return {state:'failed',signal:failure};
  const text=isExplicitSuccess(after.text);
  if(text) return {state:'success',signal:text};
  if(options.structureSelectorsEnabled === true) {
    if(before.questionCount>0 && before.submitVisible === true && after.questionCount === 0 && after.submitVisible === false && after.successMarker === true) return {state:'success',signal:'structure_confirmed'};
    if(before.questionCount!==after.questionCount || before.submitVisible!==after.submitVisible || after.successMarker === true) return {state:'submitted_pending_confirmation',signal:'structure_change'};
  }
  return {state:'submitted_pending_confirmation',signal:'none'};
}
export function confirmationPage(root) {
  return {
    text:root.body?.innerText?.replace(root.getElementById('attendance-helper-status')?.innerText || '', '') || '',
    questionCount:root.querySelectorAll('[data-automation-id="questionItem"]').length,
    submitVisible:Boolean(root.querySelector('[data-automation-id="submitButton"]')),
    successMarker:SUCCESS_PAGE_SELECTORS.some(selector=>[...root.querySelectorAll(selector)].some(node=>node.getClientRects().length && node.getAttribute('aria-hidden')!=='true'))
  };
}
export function successPageSummary(root) {
  return [...root.querySelectorAll('[data-automation-id],[role],[aria-label],h1,h2,h3,h4,h5,h6')]
    .filter(node=>!node.closest('#attendance-helper-status,[data-automation-id="questionItem"]') && node.getClientRects().length)
    .slice(0,100).map(node=>Object.fromEntries([
      ...['data-automation-id','role','aria-label'].map(key=>[key,node.getAttribute(key)]),
      ['title',node.matches('h1,h2,h3,h4,h5,h6,[role="heading"],[data-automation-id="formTitle"]')?node.textContent?.trim():null]
    ].filter(([,value])=>value).map(([key,value])=>[key,value.slice(0,250)])));
}
