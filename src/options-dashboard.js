(() => {
  "use strict";

  const dashboardKeys = ["attendanceProfile", "attendanceSessions", "attendanceBindings", "attendanceRecords", "attendanceLanguage"];
  const translations = {
    zh: {
      loading: "正在读取本机配置…",
      intro: "先填写学生资料、导入课表并检查表单绑定。概览只反映当前 Chrome 本机保存的数据。",
      profileComplete: "已填写",
      profileIncomplete: "未完成",
      profileReadyHint: "学号与姓名已保存在此 Chrome。",
      profileMissingHint: "先填写学号与姓名。"
    },
    en: {
      loading: "Reading local setup…",
      intro: "Add your profile, import a timetable, and check form bindings. This overview reflects data saved in this Chrome profile.",
      profileComplete: "Complete",
      profileIncomplete: "Incomplete",
      profileReadyHint: "Student ID and name are saved in this Chrome profile.",
      profileMissingHint: "Enter your student ID and name to get started."
    }
  };

  function countEntries(value) {
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === "object") return Object.keys(value).length;
    return 0;
  }

  function renderDashboard(data = {}, root = document) {
    const lang = data.attendanceLanguage === "en" ? "en" : "zh";
    const words = translations[lang];
    for (const label of root.querySelectorAll("[data-ui-label]")) {
      label.textContent = label.getAttribute(lang === "en" ? "data-ui-en" : "data-ui-zh") || "";
    }
    for (const label of root.querySelectorAll("[data-ui-aria-zh][data-ui-aria-en]")) {
      label.setAttribute("aria-label", label.getAttribute(lang === "en" ? "data-ui-aria-en" : "data-ui-aria-zh"));
    }

    const sessions = countEntries(data.attendanceSessions);
    const bindings = Object.values(data.attendanceBindings || {}).filter(binding => binding && binding.verified === true).length;
    const records = countEntries(data.attendanceRecords);
    const profile = data.attendanceProfile || {};
    const profileComplete = Boolean(String(profile.student || "").trim() && String(profile.name || "").trim());

    root.getElementById("overview-sessions").textContent = String(sessions);
    root.getElementById("overview-bindings").textContent = String(bindings);
    root.getElementById("overview-records").textContent = String(records);
    root.getElementById("overview-profile-status").textContent = profileComplete ? words.profileComplete : words.profileIncomplete;
    root.getElementById("overview-profile-hint").textContent = profileComplete ? words.profileReadyHint : words.profileMissingHint;
    root.getElementById("overview-status-title").textContent = lang === "en" ? "Local setup overview" : "本机配置概况";
    root.getElementById("overview-status-description").textContent = words.intro;
    root.getElementById("overview").dataset.profileComplete = String(profileComplete);
    root.getElementById("overview").dataset.sessionCount = String(sessions);
  }

  function setCurrentLink(href, root = document) {
    for (const link of root.querySelectorAll("#app-nav [data-nav-link]")) {
      if (link.getAttribute("href") === href) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  }

  function initNavigation(root = document) {
    const nav = root.getElementById("app-nav");
    if (!nav) return;
    const links = [...nav.querySelectorAll("[data-nav-link]")];
    const activate = link => {
      const target = root.querySelector(link.getAttribute("href"));
      const details = target?.matches("details") ? target : target?.closest("details");
      if (details) details.open = true;
      setCurrentLink(link.getAttribute("href"), root);
    };
    for (const link of links) link.addEventListener("click", () => activate(link));

    const sectionFor = link => {
      const target = root.querySelector(link.getAttribute("href"));
      if (!target) return null;
      return target.matches("section, details") ? target : target.closest("section, details");
    };
    let scheduled = false;
    const updateFromScroll = () => {
      scheduled = false;
      const candidates = links.map(link => ({ link, section: sectionFor(link) }))
        .filter(item => item.section && item.section.getBoundingClientRect().top <= 180)
        .sort((a, b) => b.section.getBoundingClientRect().top - a.section.getBoundingClientRect().top);
      if (candidates[0]) setCurrentLink(candidates[0].link.getAttribute("href"), root);
    };
    root.defaultView?.addEventListener("scroll", () => {
      if (scheduled) return;
      scheduled = true;
      root.defaultView.requestAnimationFrame(updateFromScroll);
    }, { passive: true });
    root.defaultView?.addEventListener("hashchange", () => {
      const link = links.find(item => item.getAttribute("href") === root.defaultView.location.hash);
      if (link) activate(link);
    });
    const initialLink = links.find(item => item.getAttribute("href") === root.defaultView?.location.hash) || links.find(item => item.getAttribute("href") === "#overview");
    if (initialLink) activate(initialLink);
  }

  async function initDashboard(api = chrome.storage, root = document) {
    const render = async () => {
      const data = await api.local.get(dashboardKeys);
      renderDashboard(data, root);
    };
    initNavigation(root);
    try {
      await render();
    } catch {
      renderDashboard({}, root);
    }
    api.onChanged?.addListener((changes, area) => {
      if (area === "local" && dashboardKeys.some(key => key in changes)) void render().catch(() => renderDashboard({}, root));
    });
  }

  if (typeof document !== "undefined" && document.getElementById("overview")) void initDashboard();
  if (typeof window !== "undefined") window.AutoCheckDashboard = { initDashboard, renderDashboard };
})();
