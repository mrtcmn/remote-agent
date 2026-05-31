// Electrobun re-exports three.js but @types/three is not installed;
// silence the implicit-any error from electrobun's own index.ts.
declare module "three";
declare module "@babylonjs/core";
