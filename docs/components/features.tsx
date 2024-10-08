import { useId } from "react";
import styles from "./features.module.css";

// import BackendAgnosticIcon from "../components/icons/backend-agnostic";
// import LightweightIcon from "../components/icons/lightweight";
// import PaginationIcon from "../components/icons/pagination";
// import RealtimeIcon from "../components/icons/realtime";
// import RemoteLocalIcon from "../components/icons/remote-local";
// import RenderingStrategiesIcon from "../components/icons/rendering-strategies";
// import SuspenseIcon from "../components/icons/suspense";
// import TypeScriptIcon from "../components/icons/typescript";

import { Icon } from "./icon";

export function Feature({ text, icon }) {
  return (
    <div className={styles.feature}>
      {icon}
      <h4>{text}</h4>
    </div>
  );
}

/** @type {{ key: string; icon: React.FC }[]} */
const FEATURES_LIST = [
  {
    key: "realtimeSchema",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        stroke-linejoin="round"
        className="icon icon-tabler icons-tabler-outline icon-tabler-chart-bar"
      >
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
        <path d="M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
        <path d="M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
        <path d="M4 20h14" />
      </svg>
    ),
  },
  {
    key: "typeSafety",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        stroke-linejoin="round"
        className="icon icon-tabler icons-tabler-outline icon-tabler-checks"
      >
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M7 12l5 5l10 -10" />
        <path d="M2 12l5 5m5 -5l5 -5" />
      </svg>
    ),
  },
  {
    key: "authentication",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        stroke-linejoin="round"
        className="icon icon-tabler icons-tabler-outline icon-tabler-lock"
      >
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z" />
        <path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0" />
        <path d="M8 11v-4a4 4 0 1 1 8 0v4" />
      </svg>
    ),
  },
  {
    key: "authorization",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        stroke-linejoin="round"
        className="icon icon-tabler icons-tabler-outline icon-tabler-shield"
      >
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3" />
      </svg>
    ),
  },
  {
    key: "runtimes",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="icon icon-tabler icon-tabler-stack-back"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        stroke-width="1.5"
        stroke="currentColor"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M4 8l8 4l8 -4l-8 -4z" />
        <path d="M12 16l-4 -2l-4 2l8 4l8 -4l-4 -2l-4 2z" fill="currentColor" />
        <path d="M8 10l-4 2l4 2m8 0l4 -2l-4 -2" />
      </svg>
    ),
  },
  {
    key: "errorTracking",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        stroke-linejoin="round"
        className="icon icon-tabler icons-tabler-outline icon-tabler-bug"
      >
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M9 9v-1a3 3 0 0 1 6 0v1" />
        <path d="M8 9h8a6 6 0 0 1 1 3v3a5 5 0 0 1 -10 0v-3a6 6 0 0 1 1 -3" />
        <path d="M3 13l4 0" />
        <path d="M17 13l4 0" />
        <path d="M12 20l0 -6" />
        <path d="M4 19l3.35 -2" />
        <path d="M20 19l-3.35 -2" />
        <path d="M4 7l3.75 2.4" />
        <path d="M20 7l-3.75 2.4" />
      </svg>
    ),
  },
  {
    key: "databaseIntegration",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        stroke-linejoin="round"
        className="icon icon-tabler icons-tabler-outline icon-tabler-tool"
      >
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M7 10h3v-3l-3.5 -3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1 -3 3l-6 -6a6 6 0 0 1 -8 -8l3.5 3.5" />
      </svg>
    ),
  },
  {
    key: "optimizedDeployment",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        stroke-linejoin="round"
        className="icon icon-tabler icons-tabler-outline icon-tabler-brand-docker"
      >
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M22 12.54c-1.804 -.345 -2.701 -1.08 -3.523 -2.94c-.487 .696 -1.102 1.568 -.92 2.4c.028 .238 -.32 1 -.557 1h-14c0 5.208 3.164 7 6.196 7c4.124 .022 7.828 -1.376 9.854 -5c1.146 -.101 2.296 -1.505 2.95 -2.46z" />
        <path d="M5 10h3v3h-3z" />
        <path d="M8 10h3v3h-3z" />
        <path d="M11 10h3v3h-3z" />
        <path d="M8 7h3v3h-3z" />
        <path d="M11 7h3v3h-3z" />
        <path d="M11 4h3v3h-3z" />
        <path d="M4.571 18c1.5 0 2.047 -.074 2.958 -.78" />
        <path d="M10 16l0 .01" />
      </svg>
    ),
  },
];

export default function Features() {
  const keyId = useId();

  const features = {
    realtimeSchema: "Real-time Schema",
    typeSafety: "Type Safety",
    authentication: "OIDC Auth",
    authorization: "Role-Based",
    runtimes: "Multiple Runtimes",
    errorTracking: "Error Tracking",
    databaseIntegration: "Prisma Integration",
    optimizedDeployment: "Docker Ready",
  };

  return (
    <div className="mx-auto max-w-full w-[880px] text-center px-4 mb-10">
      <p className="text-lg mb-2 text-gray-600 md:!text-2xl">
        A code-first approach to GraphQL API development
      </p>
      <div className={styles.features}>
        {FEATURES_LIST.map(({ key, icon }) => (
          <Feature text={features[key]} icon={icon} key={keyId + key} />
        ))}
      </div>
    </div>
  );
}
