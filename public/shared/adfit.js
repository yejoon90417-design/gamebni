(() => {
  const adUnit = "DAN-HAZ0CPFP6aFhXfcw";
  const adWidth = "728";
  const adHeight = "90";
  const visibleDisplay = "flex";

  if (document.querySelector("[data-adfit-banner='true']")) {
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.dataset.adfitBanner = "true";
  wrapper.style.display = visibleDisplay;
  wrapper.style.justifyContent = "center";
  wrapper.style.padding = "16px 16px 0";
  wrapper.style.overflowX = "auto";

  const ad = document.createElement("ins");
  ad.className = "kakao_ad_area";
  ad.style.display = "none";
  ad.dataset.adUnit = adUnit;
  ad.dataset.adWidth = adWidth;
  ad.dataset.adHeight = adHeight;
  wrapper.appendChild(ad);

  const app = document.querySelector(".app");
  if (app && app.parentNode) {
    app.parentNode.insertBefore(wrapper, app);
  } else {
    document.body.insertBefore(wrapper, document.body.firstChild);
  }

  const gameScreen = document.getElementById("gameScreen");
  const syncVisibility = () => {
    const showBanner = !gameScreen || gameScreen.hidden;
    wrapper.style.display = showBanner ? visibleDisplay : "none";
  };

  syncVisibility();

  if (gameScreen) {
    const observer = new MutationObserver(syncVisibility);
    observer.observe(gameScreen, {
      attributes: true,
      attributeFilter: ["hidden"],
    });
  }

  if (!document.querySelector("script[data-adfit-loader='true']")) {
    const script = document.createElement("script");
    script.async = true;
    script.type = "text/javascript";
    script.src = "https://t1.daumcdn.net/kas/static/ba.min.js";
    script.dataset.adfitLoader = "true";
    document.body.appendChild(script);
  }
})();
