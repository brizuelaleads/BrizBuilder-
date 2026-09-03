export type InstallPlatform = "ios" | "android" | "desktop";

export type InstallBrowser =
  | "safari"
  | "chrome"
  | "edge"
  | "firefox"
  | "chromium"
  | "other";

export type InstallEnvironment = {
  platform: InstallPlatform;
  browser: InstallBrowser;
  deviceLabel: "iPhone" | "iPad" | "Android" | "computer";
  standalone: boolean;
};

export type ManualInstallGuideStep = {
  icon: "share" | "add" | "check" | "menu" | "copy";
  title: string;
  detail: string;
};

export type ManualInstallGuide = {
  eyebrow: string;
  title: string;
  steps: ManualInstallGuideStep[];
  safariFallback?: boolean;
  desktopQr?: boolean;
};

export type InstallEnvironmentInput = {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  displayModeStandalone?: boolean;
  navigatorStandalone?: boolean;
};

function iosBrowser(userAgent: string): InstallBrowser {
  if (/crios/i.test(userAgent)) return "chrome";
  if (/edgios/i.test(userAgent)) return "edge";
  if (/fxios/i.test(userAgent)) return "firefox";
  if (/safari/i.test(userAgent)) return "safari";
  return "other";
}

function androidBrowser(userAgent: string): InstallBrowser {
  if (/edga?|edg\//i.test(userAgent)) return "edge";
  if (/firefox|fennec/i.test(userAgent)) return "firefox";
  if (/samsungbrowser|opr\/|opera|chromium/i.test(userAgent)) {
    return "chromium";
  }
  if (/chrome\//i.test(userAgent)) return "chrome";
  return "other";
}

function desktopBrowser(userAgent: string): InstallBrowser {
  if (/edg\//i.test(userAgent)) return "edge";
  if (/firefox\//i.test(userAgent)) return "firefox";
  if (/chrome\//i.test(userAgent)) return "chrome";
  if (/safari\//i.test(userAgent)) return "safari";
  return "other";
}

/**
 * Capability state wins over browser identity. Browser detection is only used
 * after that to choose truthful manual-install wording.
 */
export function detectInstallEnvironment(
  input: InstallEnvironmentInput,
): InstallEnvironment {
  const userAgent = input.userAgent;
  const ipadDesktopMode =
    input.platform === "MacIntel" && (input.maxTouchPoints ?? 0) > 1;
  const ipad = /ipad/i.test(userAgent) || ipadDesktopMode;
  const ios = /iphone|ipad|ipod/i.test(userAgent) || ipadDesktopMode;
  const standalone = Boolean(
    input.displayModeStandalone || input.navigatorStandalone,
  );

  if (ios) {
    return {
      platform: "ios",
      browser: iosBrowser(userAgent),
      deviceLabel: ipad ? "iPad" : "iPhone",
      standalone,
    };
  }

  if (/android/i.test(userAgent)) {
    return {
      platform: "android",
      browser: androidBrowser(userAgent),
      deviceLabel: "Android",
      standalone,
    };
  }

  return {
    platform: "desktop",
    browser: desktopBrowser(userAgent),
    deviceLabel: "computer",
    standalone,
  };
}

export function currentInstallEnvironment(): InstallEnvironment {
  return detectInstallEnvironment({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
    navigatorStandalone:
      "standalone" in navigator
        ? Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
        : false,
  });
}

export function manualInstallGuideFor(
  environment: InstallEnvironment,
): ManualInstallGuide {
  if (environment.platform === "desktop") {
    return {
      eyebrow: "INSTALL ON YOUR PHONE",
      title: "Scan to install",
      desktopQr: true,
      steps: [],
    };
  }

  if (environment.platform === "android") {
    const browserName =
      environment.browser === "chrome"
        ? "Chrome"
        : environment.browser === "edge"
          ? "Edge"
          : "your browser";
    const installLabel =
      environment.browser === "edge"
        ? "Add to phone or Install app"
        : "Install app or Add to Home screen";
    return {
      eyebrow: "INSTALL ON ANDROID",
      title: "Install from the browser menu",
      steps: [
        {
          icon: "menu",
          title: `Open the ${browserName} menu`,
          detail: "Tap the menu button near the address bar.",
        },
        {
          icon: "add",
          title: installLabel,
          detail: "Choose the install option shown by your browser.",
        },
        {
          icon: "check",
          title: "Confirm",
          detail: "The app will appear on your home screen.",
        },
      ],
    };
  }

  if (environment.browser === "edge" || environment.browser === "other") {
    return {
      eyebrow: `INSTALL ON ${environment.deviceLabel.toUpperCase()}`,
      title: "Open in Safari to install",
      safariFallback: true,
      steps: [
        {
          icon: "copy",
          title: "Copy this link",
          detail: "Use the button below so the address is ready.",
        },
        {
          icon: "share",
          title: "Open Safari and paste the link",
          detail: "Then tap the Share button.",
        },
        {
          icon: "add",
          title: "Add to Home Screen",
          detail: "Choose Add to Home Screen, then tap Add.",
        },
      ],
    };
  }

  const shareDetail =
    environment.browser === "chrome"
      ? "Use Share to the right of Chrome's address bar."
      : environment.browser === "firefox"
        ? "Use the Share icon in Firefox's address bar."
        : "Use the Share button in Safari.";
  return {
    eyebrow: `INSTALL ON ${environment.deviceLabel.toUpperCase()}`,
    title: `Install on ${environment.deviceLabel}`,
    steps: [
      { icon: "share", title: "Tap Share", detail: shareDetail },
      {
        icon: "add",
        title: "Add to Home Screen",
        detail: "Choose it from the share menu.",
      },
      {
        icon: "check",
        title: "Tap Add",
        detail: "The app will appear on your home screen.",
      },
    ],
  };
}
