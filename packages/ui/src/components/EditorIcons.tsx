/**
 * Real brand icons for desktop code editors, inlined as raw SVG.
 *
 * Sources: official VS Code icon (Wikimedia), official JetBrains WebStorm
 * icon, lobehub brand set (Cursor, Antigravity), Simple Icons (Zed).
 * Regenerate via the gen.ts script kept alongside the downloaded SVGs.
 *
 * Used by `OpenInEditorButton` in local mode.
 */

import * as React from 'react';

export type EditorId = 'vscode' | 'cursor' | 'webstorm' | 'zed' | 'antigravity';

type IconProps = { size?: number; className?: string };

// Trusted static SVGs baked into the bundle — no runtime fetch.
const RAW: Record<EditorId, string> = {
  vscode: "<svg viewBox=\"0 0 100 100\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<mask id=\"vsc-mask0\" mask-type=\"alpha\" maskUnits=\"userSpaceOnUse\" x=\"0\" y=\"0\" width=\"100\" height=\"100\">\n<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M70.9119 99.3171C72.4869 99.9307 74.2828 99.8914 75.8725 99.1264L96.4608 89.2197C98.6242 88.1787 100 85.9892 100 83.5872V16.4133C100 14.0113 98.6243 11.8218 96.4609 10.7808L75.8725 0.873756C73.7862 -0.130129 71.3446 0.11576 69.5135 1.44695C69.252 1.63711 69.0028 1.84943 68.769 2.08341L29.3551 38.0415L12.1872 25.0096C10.589 23.7965 8.35363 23.8959 6.86933 25.2461L1.36303 30.2549C-0.452552 31.9064 -0.454633 34.7627 1.35853 36.417L16.2471 50.0001L1.35853 63.5832C-0.454633 65.2374 -0.452552 68.0938 1.36303 69.7453L6.86933 74.7541C8.35363 76.1043 10.589 76.2037 12.1872 74.9905L29.3551 61.9587L68.769 97.9167C69.3925 98.5406 70.1246 99.0104 70.9119 99.3171ZM75.0152 27.2989L45.1091 50.0001L75.0152 72.7012V27.2989Z\" fill=\"white\"/>\n</mask>\n<g mask=\"url(#vsc-mask0)\">\n<path d=\"M96.4614 10.7962L75.8569 0.875542C73.4719 -0.272773 70.6217 0.211611 68.75 2.08333L1.29858 63.5832C-0.515693 65.2373 -0.513607 68.0937 1.30308 69.7452L6.81272 74.754C8.29793 76.1042 10.5347 76.2036 12.1338 74.9905L93.3609 13.3699C96.086 11.3026 100 13.2462 100 16.6667V16.4275C100 14.0265 98.6246 11.8378 96.4614 10.7962Z\" fill=\"#0065A9\"/>\n<g filter=\"url(#vsc-filter0_d)\">\n<path d=\"M96.4614 89.2038L75.8569 99.1245C73.4719 100.273 70.6217 99.7884 68.75 97.9167L1.29858 36.4169C-0.515693 34.7627 -0.513607 31.9063 1.30308 30.2548L6.81272 25.246C8.29793 23.8958 10.5347 23.7964 12.1338 25.0095L93.3609 86.6301C96.086 88.6974 100 86.7538 100 83.3334V83.5726C100 85.9735 98.6246 88.1622 96.4614 89.2038Z\" fill=\"#007ACC\"/>\n</g>\n<g filter=\"url(#vsc-filter1_d)\">\n<path d=\"M75.8578 99.1263C73.4721 100.274 70.6219 99.7885 68.75 97.9166C71.0564 100.223 75 98.5895 75 95.3278V4.67213C75 1.41039 71.0564 -0.223106 68.75 2.08329C70.6219 0.211402 73.4721 -0.273666 75.8578 0.873633L96.4587 10.7807C98.6234 11.8217 100 14.0112 100 16.4132V83.5871C100 85.9891 98.6234 88.1786 96.4586 89.2196L75.8578 99.1263Z\" fill=\"#1F9CF0\"/>\n</g>\n<g style=\"mix-blend-mode:overlay\" opacity=\"0.25\">\n<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M70.8511 99.3171C72.4261 99.9306 74.2221 99.8913 75.8117 99.1264L96.4 89.2197C98.5634 88.1787 99.9392 85.9892 99.9392 83.5871V16.4133C99.9392 14.0112 98.5635 11.8217 96.4001 10.7807L75.8117 0.873695C73.7255 -0.13019 71.2838 0.115699 69.4527 1.44688C69.1912 1.63705 68.942 1.84937 68.7082 2.08335L29.2943 38.0414L12.1264 25.0096C10.5283 23.7964 8.29285 23.8959 6.80855 25.246L1.30225 30.2548C-0.513334 31.9064 -0.515415 34.7627 1.29775 36.4169L16.1863 50L1.29775 63.5832C-0.515415 65.2374 -0.513334 68.0937 1.30225 69.7452L6.80855 74.754C8.29285 76.1042 10.5283 76.2036 12.1264 74.9905L29.2943 61.9586L68.7082 97.9167C69.3317 98.5405 70.0638 99.0104 70.8511 99.3171ZM74.9544 27.2989L45.0483 50L74.9544 72.7012V27.2989Z\" fill=\"url(#vsc-paint0_linear)\"/>\n</g>\n</g>\n<defs>\n<filter id=\"vsc-filter0_d\" x=\"-8.39411\" y=\"15.8291\" width=\"116.727\" height=\"92.2456\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\">\n<feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"/>\n<feColorMatrix in=\"SourceAlpha\" type=\"matrix\" values=\"0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0\"/>\n<feOffset/>\n<feGaussianBlur stdDeviation=\"4.16667\"/>\n<feColorMatrix type=\"matrix\" values=\"0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0\"/>\n<feBlend mode=\"overlay\" in2=\"BackgroundImageFix\" result=\"effect1_dropShadow\"/>\n<feBlend mode=\"normal\" in=\"SourceGraphic\" in2=\"effect1_dropShadow\" result=\"shape\"/>\n</filter>\n<filter id=\"vsc-filter1_d\" x=\"60.4167\" y=\"-8.07558\" width=\"47.9167\" height=\"116.151\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\">\n<feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"/>\n<feColorMatrix in=\"SourceAlpha\" type=\"matrix\" values=\"0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0\"/>\n<feOffset/>\n<feGaussianBlur stdDeviation=\"4.16667\"/>\n<feColorMatrix type=\"matrix\" values=\"0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0\"/>\n<feBlend mode=\"overlay\" in2=\"BackgroundImageFix\" result=\"effect1_dropShadow\"/>\n<feBlend mode=\"normal\" in=\"SourceGraphic\" in2=\"effect1_dropShadow\" result=\"shape\"/>\n</filter>\n<linearGradient id=\"vsc-paint0_linear\" x1=\"49.9392\" y1=\"0.257812\" x2=\"49.9392\" y2=\"99.7423\" gradientUnits=\"userSpaceOnUse\">\n<stop stop-color=\"white\"/>\n<stop offset=\"1\" stop-color=\"white\" stop-opacity=\"0\"/>\n</linearGradient>\n</defs>\n</svg>",
  cursor: "<svg fill=\"currentColor\" fill-rule=\"evenodd\" height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Cursor</title><path d=\"M22.106 5.68L12.5.135a.998.998 0 00-.998 0L1.893 5.68a.84.84 0 00-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 00.998 0l9.608-5.547a.84.84 0 00.42-.727V6.407a.84.84 0 00-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 00-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z\"></path></svg>",
  webstorm: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"64\" fill=\"none\" viewBox=\"0 0 64 64\">\n  <defs>\n    <linearGradient id=\"ws-a\" x1=\"7.62141\" x2=\"61.2476\" y1=\"64.7192\" y2=\"39.8564\" gradientUnits=\"userSpaceOnUse\">\n      <stop offset=\".22\" stop-color=\"#F0EB18\"/>\n      <stop offset=\".59\" stop-color=\"#00C4F4\"/>\n    </linearGradient>\n    <linearGradient id=\"ws-b\" x1=\"60.0186\" x2=\"1.31316\" y1=\"59.7777\" y2=\"1.07287\" gradientUnits=\"userSpaceOnUse\">\n      <stop offset=\".19\" stop-color=\"#00C4F4\"/>\n      <stop offset=\".83\" stop-color=\"#007DFE\"/>\n    </linearGradient>\n  </defs>\n  <path fill=\"#F0EB18\" d=\"m5.81836 48.0512.00174 11.8755c0 2.2493 1.82342 4.0721 4.07273 4.0721H21.3994c1.1887 0 2.3186-.5196 3.0924-1.422l32.7098-38.1614c.6325-.7383.9804-1.6786.9804-2.6508V9.88913c0-2.24931-1.8234-4.07272-4.0727-4.07272H42.6009c-1.1887 0-2.3185.51956-3.0924 1.42196L6.79872 45.3998c-.63302.7383-.98036 1.6786-.98036 2.6514Z\"/>\n  <path fill=\"url(#ws-a)\" d=\"M5.81836 49.4825v10.4466c0 2.2493 1.82342 4.0727 4.07273 4.0727H22.9837c.1926 0 .3852-.014.576-.0407l36.9437-5.2771c2.0067-.2868 3.4968-2.005 3.4968-4.032V38.979c0-2.2499-1.824-4.0733-4.0739-4.0727l-18.5385.0046c-.4375 0-.8721.0704-1.287.2089L8.60294 45.6193c-1.66284.5544-2.78458 2.1108-2.78458 3.8638v-.0006Z\"/>\n  <path fill=\"url(#ws-b)\" d=\"M0 4.07273V38.041c0 1.6291.971054 3.1017 2.46807 3.7434L39.9587 57.8525c.5067.217 1.0531.3293 1.6046.3293h18.364c2.2493 0 4.0727-1.8234 4.0727-4.0727v-17.966c0-.8046-.2386-1.5913-.6854-2.2609L41.9113 1.81353C41.1561.681309 39.8854.001745 38.5239.001745L4.07273 0C1.82342 0 0 1.82342 0 4.07273Z\"/>\n  <path fill=\"#000\" d=\"M52 12H12v40h40V12Z\"/>\n  <path fill=\"#fff\" d=\"m21.2377 27.961-2.4224-10.9532h-3.0321l3.6224 15.0044h3.3226l2.5613-10.8998 2.5292 10.8998h3.333l3.6441-15.0044h-2.9689L29.4797 27.961l-2.7008-10.9532h-2.9581L21.2377 27.961Z\"/>\n  <path fill=\"#fff\" d=\"M38.2224 31.6804c.8429.3927 1.8074.5896 2.8937.5896s2.0515-.1998 2.8944-.6005c.8428-.4008 1.4968-.9503 1.9613-1.6507.4714-.7074.7073-1.5049.7073-2.3903 0-.7222-.1607-1.3865-.4822-1.9934-.3216-.6149-.7717-1.1294-1.3505-1.5434-.5718-.422-1.2252-.7073-1.9613-.8572l-2.551-.5575c-.4644-.1137-.8325-.3066-1.1041-.5787-.2646-.2722-.3967-.615-.3967-1.0289 0-.364.0965-.6815.2894-.9537.1929-.2785.461-.4932.8038-.643.3497-.1568.7539-.236 1.2109-.236.457 0 .8607.0815 1.2109.2463.3571.1567.6321.3818.8251.6752.1929.2854.2893.6109.2893.9755h2.9259c-.0074-.8572-.236-1.614-.6861-2.272-.4432-.6648-1.0645-1.1833-1.8649-1.5542-.8003-.3715-1.7253-.5575-2.7329-.5575-1.0077 0-1.908.1929-2.7009.5788-.7929.3789-1.4107.9106-1.8539 1.5967-.4427.6792-.6643 1.4469-.6643 2.3041 0 .7073.1464 1.3441.4392 1.9079.2934.5644.7039 1.0398 1.2327 1.4256.5288.379 1.1506.6471 1.8649.8038l2.6474.5897c.5076.1223.9037.3393 1.1897.654.2928.3146.4392.7113.4392 1.1896 0 .3859-.1074.7286-.3215 1.0289-.2073.3003-.5036.5357-.8894.7074-.3789.1648-.8004.2463-1.3292.2463-.5288 0-.9967-.0925-1.4038-.2785-.4071-.186-.7251-.4432-.9537-.7716-.2285-.3279-.3427-.7114-.3427-1.1466h-2.9368c.0143.9215.2572 1.7362.7286 2.4436.4788.7073 1.1362 1.2579 1.9722 1.6507Z\"/>\n  <path fill=\"#fff\" d=\"M16.9932 44h16v3h-16v-3Z\"/>\n</svg>",
  zed: "<svg fill=\"#084CCF\" role=\"img\" viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\"><title>Zed Industries</title><path d=\"M2.25 1.5a.75.75 0 0 0-.75.75v16.5H0V2.25A2.25 2.25 0 0 1 2.25 0h20.095c1.002 0 1.504 1.212.795 1.92L10.764 14.298h3.486V12.75h1.5v1.922a1.125 1.125 0 0 1-1.125 1.125H9.264l-2.578 2.578h11.689V9h1.5v9.375a1.5 1.5 0 0 1-1.5 1.5H5.185L2.562 22.5H21.75a.75.75 0 0 0 .75-.75V5.25H24v16.5A2.25 2.25 0 0 1 21.75 24H1.655C.653 24 .151 22.788.86 22.08L13.19 9.75H9.75v1.5h-1.5V9.375A1.125 1.125 0 0 1 9.375 8.25h5.314l2.625-2.625H5.625V15h-1.5V5.625a1.5 1.5 0 0 1 1.5-1.5h13.19L21.438 1.5z\"/></svg>",
  antigravity: "<svg height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Antigravity</title><mask height=\"23\" id=\"lobe-icons-antigravity-0-_R_0_\" maskUnits=\"userSpaceOnUse\" width=\"24\" x=\"0\" y=\"1\"><path d=\"M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z\" fill=\"#fff\"></path></mask><g mask=\"url(#lobe-icons-antigravity-0-_R_0_)\"><g filter=\"url(#lobe-icons-antigravity-1-_R_0_)\"><path d=\"M-1.018-3.992c-.408 3.591 2.686 6.89 6.91 7.37 4.225.48 7.98-2.043 8.387-5.633.408-3.59-2.686-6.89-6.91-7.37-4.225-.479-7.98 2.043-8.387 5.633z\" fill=\"#FFE432\"></path></g><g filter=\"url(#lobe-icons-antigravity-2-_R_0_)\"><path d=\"M15.269 7.747c1.058 4.557 5.691 7.374 10.348 6.293 4.657-1.082 7.575-5.653 6.516-10.21-1.058-4.556-5.691-7.374-10.348-6.292-4.657 1.082-7.575 5.653-6.516 10.21z\" fill=\"#FC413D\"></path></g><g filter=\"url(#lobe-icons-antigravity-3-_R_0_)\"><path d=\"M-12.443 10.804c1.338 4.703 7.36 7.11 13.453 5.378 6.092-1.733 9.947-6.95 8.61-11.652C8.282-.173 2.26-2.58-3.833-.848-9.925.884-13.78 6.1-12.443 10.804z\" fill=\"#00B95C\"></path></g><g filter=\"url(#lobe-icons-antigravity-4-_R_0_)\"><path d=\"M-12.443 10.804c1.338 4.703 7.36 7.11 13.453 5.378 6.092-1.733 9.947-6.95 8.61-11.652C8.282-.173 2.26-2.58-3.833-.848-9.925.884-13.78 6.1-12.443 10.804z\" fill=\"#00B95C\"></path></g><g filter=\"url(#lobe-icons-antigravity-5-_R_0_)\"><path d=\"M-7.608 14.703c3.352 3.424 9.126 3.208 12.896-.483 3.77-3.69 4.108-9.459.756-12.883C2.69-2.087-3.083-1.871-6.853 1.82c-3.77 3.69-4.108 9.458-.755 12.883z\" fill=\"#00B95C\"></path></g><g filter=\"url(#lobe-icons-antigravity-6-_R_0_)\"><path d=\"M9.932 27.617c1.04 4.482 5.384 7.303 9.7 6.3 4.316-1.002 6.971-5.448 5.93-9.93-1.04-4.483-5.384-7.304-9.7-6.301-4.316 1.002-6.971 5.448-5.93 9.93z\" fill=\"#3186FF\"></path></g><g filter=\"url(#lobe-icons-antigravity-7-_R_0_)\"><path d=\"M2.572-8.185C.392-3.329 2.778 2.472 7.9 4.771c5.122 2.3 11.042.227 13.222-4.63 2.18-4.855-.205-10.656-5.327-12.955-5.122-2.3-11.042-.227-13.222 4.63z\" fill=\"#FBBC04\"></path></g><g filter=\"url(#lobe-icons-antigravity-8-_R_0_)\"><path d=\"M-3.267 38.686c-5.277-2.072 3.742-19.117 5.984-24.83 2.243-5.712 8.34-8.664 13.616-6.592 5.278 2.071 11.533 13.482 9.29 19.195-2.242 5.713-23.613 14.298-28.89 12.227z\" fill=\"#3186FF\"></path></g><g filter=\"url(#lobe-icons-antigravity-9-_R_0_)\"><path d=\"M28.71 17.471c-1.413 1.649-5.1.808-8.236-1.878-3.135-2.687-4.531-6.201-3.118-7.85 1.412-1.649 5.1-.808 8.235 1.878s4.532 6.2 3.119 7.85z\" fill=\"#749BFF\"></path></g><g filter=\"url(#lobe-icons-antigravity-10-_R_0_)\"><path d=\"M18.163 9.077c5.81 3.93 12.502 4.19 14.946.577 2.443-3.612-.287-9.727-6.098-13.658-5.81-3.931-12.502-4.19-14.946-.577-2.443 3.612.287 9.727 6.098 13.658z\" fill=\"#FC413D\"></path></g><g filter=\"url(#lobe-icons-antigravity-11-_R_0_)\"><path d=\"M-.915 2.684c-1.44 3.473-.97 6.967 1.05 7.804 2.02.837 4.824-1.3 6.264-4.772 1.44-3.473.97-6.967-1.05-7.804-2.02-.837-4.824 1.3-6.264 4.772z\" fill=\"#FFEE48\"></path></g></g><defs><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"17.587\" id=\"lobe-icons-antigravity-1-_R_0_\" width=\"19.838\" x=\"-3.288\" y=\"-11.917\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"1.117\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"38.565\" id=\"lobe-icons-antigravity-2-_R_0_\" width=\"38.9\" x=\"4.251\" y=\"-13.493\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"5.4\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"36.517\" id=\"lobe-icons-antigravity-3-_R_0_\" width=\"40.955\" x=\"-21.889\" y=\"-10.592\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"4.591\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"36.517\" id=\"lobe-icons-antigravity-4-_R_0_\" width=\"40.955\" x=\"-21.889\" y=\"-10.592\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"4.591\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"36.595\" id=\"lobe-icons-antigravity-5-_R_0_\" width=\"36.632\" x=\"-19.099\" y=\"-10.278\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"4.591\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"34.087\" id=\"lobe-icons-antigravity-6-_R_0_\" width=\"33.533\" x=\".981\" y=\"8.758\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"4.363\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"35.276\" id=\"lobe-icons-antigravity-7-_R_0_\" width=\"35.978\" x=\"-6.143\" y=\"-21.659\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"3.954\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"46.523\" id=\"lobe-icons-antigravity-8-_R_0_\" width=\"45.114\" x=\"-11.96\" y=\"-.46\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"3.531\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"24.054\" id=\"lobe-icons-antigravity-9-_R_0_\" width=\"25.094\" x=\"10.485\" y=\".58\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"3.159\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"30.007\" id=\"lobe-icons-antigravity-10-_R_0_\" width=\"33.508\" x=\"5.833\" y=\"-12.467\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"2.669\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"26.151\" id=\"lobe-icons-antigravity-11-_R_0_\" width=\"22.194\" x=\"-8.355\" y=\"-8.876\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"3.303\"></feGaussianBlur></filter></defs></svg>",
};

/** Drop fixed width/height on the root tag; the wrapper span controls size. */
function stripRootSize(svg: string): string {
  const end = svg.indexOf('>') + 1;
  const head = svg
    .slice(0, end)
    .replace(/ (?:width|height)="[^"]*"/g, '')
    .replace('<svg', '<svg width="100%" height="100%"');
  return head + svg.slice(end);
}

function makeIcon(id: EditorId): React.FC<IconProps> {
  const html = stripRootSize(RAW[id]);
  return function EditorIcon({ size = 14, className }: IconProps) {
    return (
      <span
        className={className}
        style={{ width: size, height: size, display: 'inline-flex', flexShrink: 0 }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  };
}

// ─── Catalog ────────────────────────────────────────────────────────────────

export interface EditorDef {
  id: EditorId;
  label: string;
  /** Accent color used for hover / brand emphasis. */
  color: string;
  /** Builds the OS deep-link URL given an absolute folder path. */
  deepLink: (absolutePath: string) => string;
  Icon: React.FC<IconProps>;
}

export const EDITORS: EditorDef[] = [
  {
    id: 'vscode',
    label: 'VS Code',
    color: '#007ACC',
    deepLink: (p) => `vscode://file${encodeURI(p)}`,
    Icon: makeIcon('vscode'),
  },
  {
    id: 'cursor',
    label: 'Cursor',
    color: '#FFFFFF',
    deepLink: (p) => `cursor://file${encodeURI(p)}`,
    Icon: makeIcon('cursor'),
  },
  {
    id: 'webstorm',
    label: 'WebStorm',
    color: '#00C4F4',
    // JetBrains Toolbox protocol handler — opens existing folder in WebStorm.
    deepLink: (p) =>
      `jetbrains://web-storm/navigate/reference?project=${encodeURIComponent(p)}`,
    Icon: makeIcon('webstorm'),
  },
  {
    id: 'zed',
    label: 'Zed',
    color: '#084CCF',
    deepLink: (p) => `zed://file${encodeURI(p)}`,
    Icon: makeIcon('zed'),
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    color: '#9B72F2',
    deepLink: (p) => `antigravity://file${encodeURI(p)}`,
    Icon: makeIcon('antigravity'),
  },
];

export function getEditorById(id: EditorId | null | undefined): EditorDef | undefined {
  if (!id) return undefined;
  return EDITORS.find((e) => e.id === id);
}
