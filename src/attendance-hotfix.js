(() => {
  const successRules = [
    ["en_answers_submitted", /\byour answers? have been submitted successfully\b/i],
    ["en_response_submitted", /\byour response was submitted\b/i],
    ["en_response_recorded", /\byour response has been (?:submitted|recorded)\b/i],
    ["zh_response_submitted", /(?:你的|您的)(?:响应|答复|回复)已(?:成功)?(?:提交|记录)/i],
    ["ms_response_submitted", /(?:respons|jawapan)\s+(?:anda|awak)\s+(?:telah|sudah)\s+(?:dihantar|dihantarkan|direkodkan)/i],
    ["ms_thanks_submitted", /terima kasih[\s,，]*(?:respons|jawapan).*?(?:dihantar|direkodkan)/i]
  ];

  function isExplicitSuccess(text) {
    const value = String(text || "");
    return successRules.find(([, rule]) => rule.test(value))?.[0] || null;
  }

  function extractGroup(text) {
    return String(text || "").match(/\bGroup\s*([123])\b/i)?.[1] || "";
  }

  function requiresDateCheck(plan) {
    return plan.some((entry) => entry.type === "date" && !entry.skip);
  }

  function parseCourseCode(text) {
    const match = String(text || "").match(/(?:^|[^A-Z0-9])([A-Z]{3,})([ \t\r\n]*[-–—]?[ \t\r\n]*)([0-9IO]{4})(?=$|[^A-Z0-9])/i);
    if (!match) return { raw: "", value: "", corrected: false };
    const raw = `${match[1]}${match[2]}${match[3]}`;
    const value = `${match[1]}${match[3].toUpperCase().replace(/[IO]/g, (letter) => letter === "I" ? "1" : "0")}`.toUpperCase();
    return { raw, value, corrected: raw.replace(/[ \t\r\n\-–—]/g, "").toUpperCase() !== value };
  }

  function filterOtherLabGroups(rows, selectedGroup) {
    const group = String(selectedGroup || "all");
    if (!/^[123]$/.test(group)) return rows;
    return rows.filter((row) => {
      const type = String(row.type || row.course || "");
      if (!/(?:^|[-\s])LAB(?:$|\s)/i.test(type)) return true;
      const detected = String(row.group || extractGroup(row.course) || "");
      return !detected || detected === group;
    });
  }

  const api = { isExplicitSuccess, extractGroup, filterOtherLabGroups, requiresDateCheck, parseCourseCode };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.AttendanceHotfix = api;
})();
