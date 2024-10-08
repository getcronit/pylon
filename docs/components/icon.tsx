import { SVGProps, useId } from "react";
import clsx from "clsx";

import { InstallationIcon } from "./icons/InstallationIcon";
import { LightbulbIcon } from "./icons/LightbulbIcon";
import { PluginsIcon } from "./icons/PluginsIcon";
import { PresetsIcon } from "./icons/PresetsIcon";
import { ThemingIcon } from "./icons/ThemingIcon";
import { WarningIcon } from "./icons/WarningIcon";

const icons = {
  installation: InstallationIcon,
  presets: PresetsIcon,
  plugins: PluginsIcon,
  theming: ThemingIcon,
  lightbulb: LightbulbIcon,
  warning: WarningIcon,
};

export type Icons = keyof typeof icons;

const iconStyles = {
  blue: "[--icon-foreground:theme(colors.slate.900)] [--icon-background:theme(colors.white)]",
  amber:
    "[--icon-foreground:theme(colors.amber.900)] [--icon-background:theme(colors.amber.100)]",
};

export const Icon: React.FC<
  SVGProps<SVGSVGElement> & {
    color?: keyof typeof iconStyles;
    icon: keyof typeof icons;
  }
> = ({ color = "blue", icon, className, ...props }) => {
  let id = useId();
  let IconComponent = icons[icon];

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 32"
      fill="none"
      className={clsx(className, iconStyles[color])}
      {...props}
    >
      <IconComponent id={id} color={color} />
    </svg>
  );
};

const gradients = {
  blue: [
    { stopColor: "#0EA5E9" },
    { stopColor: "#22D3EE", offset: ".527" },
    { stopColor: "#818CF8", offset: 1 },
  ],
  amber: [
    { stopColor: "#FDE68A", offset: ".08" },
    { stopColor: "#F59E0B", offset: ".837" },
  ],
};

export const Gradient: React.FC<
  SVGProps<SVGRadialGradientElement> & {
    color: keyof typeof gradients;
  }
> = ({ color = "blue", ...props }) => {
  return (
    <radialGradient
      cx={0}
      cy={0}
      r={1}
      gradientUnits="userSpaceOnUse"
      {...props}
    >
      {gradients[color].map((stop, stopIndex) => (
        <stop key={stopIndex} {...stop} />
      ))}
    </radialGradient>
  );
};

export const LightMode: React.FC<SVGProps<SVGSVGElement>> = ({
  className,
  ...props
}) => {
  return <g className={clsx("dark:hidden", className)} {...props} />;
};

export const DarkMode: React.FC<SVGProps<SVGSVGElement>> = ({
  className,
  ...props
}) => {
  return <g className={clsx("hidden dark:inline", className)} {...props} />;
};
