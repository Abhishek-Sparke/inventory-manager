// CSS and CSS Module type declarations for Expo Web and React Native Web
declare module '*.module.css' {
  export const unstable_styles: { readonly [key: string]: object };
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.module.scss' {
  export const unstable_styles: { readonly [key: string]: object };
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.module.sass' {
  export const unstable_styles: { readonly [key: string]: object };
  const classes: { readonly [key: string]: string };
  export default classes;
}

// Side-effect and static imports for stylesheet files
declare module '*.css';
declare module '*.scss';
declare module '*.sass';
