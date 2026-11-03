const aliases={lec:'lecture',lect:'lecture',lecture:'lecture',tut:'tutorial',tutorial:'tutorial',lab:'lab',laboratory:'lab'};
function parse(value) {
  const kinds=new Set([...String(value||'').matchAll(/(?:^|[^a-z0-9])(lecture|lect|lec|tutorial|tut|laboratory|lab)(?:\d+)?(?=$|[^a-z0-9])/gi)].map(match=>aliases[match[1].toLowerCase()]));
  return kinds.size===1?[...kinds][0]:null;
}
export function resolveCourseKind({type,course}={}) {
  return parse(type)||parse(course);
}
export function courseKindWarning(session) {
  return `${session.course} 缺少课型（LEC/TUT/LAB），请在课表中补全后再启用`;
}
export function unknownCourseKind(session) {
  const error=Error(courseKindWarning(session));
  error.code='course_kind_unknown';
  return error;
}
