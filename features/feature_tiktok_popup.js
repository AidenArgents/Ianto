// feature_tiktok_popup.js

const MODE_A = "DOMAIN_A_FIXED";
const MODE_B = "DOMAIN_B_FIXED";
const MODE_C = "DOMAIN_C_FIXED";
const MODE_NONE = "NONE";

document.addEventListener("DOMContentLoaded", () => {
    const buttons = document.querySelectorAll(".tt-mode-button");

    function setActiveMode(currentMode) {
        buttons.forEach(btn => {
            btn.classList.remove("active-mode");
            if (btn.getAttribute("data-mode") === currentMode) {
                btn.classList.add("active-mode");
            }
        });
    }

    chrome.storage.local.get("REDIRECT_MODE", (data) => {
        const currentMode = data.REDIRECT_MODE || MODE_NONE;
        setActiveMode(currentMode);
    });

    buttons.forEach(btn => {
        btn.addEventListener("click", (event) => {
            const newMode = event.currentTarget.getAttribute("data-mode");

            chrome.storage.local.set({ REDIRECT_MODE: newMode }, () => {
                console.log("TikTok redirect mode set to: " + newMode);
                setActiveMode(newMode);
            });

            if (newMode === MODE_A || newMode === MODE_B || newMode === MODE_C) {
                chrome.runtime.sendMessage({
                    command: "SET_MODE_AND_REDIRECT",
                    mode: newMode
                });
            }
        });
    });
});
