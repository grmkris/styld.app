/** The prompts behind a piece's turn on a hanger.
 *
 * Both are adapted from Amir Mušić's interactive-garment-starter (MIT): its `prompts/image-profile.md` for the strict
 * side view and its locked-camera quarter-turn prompt. The spikes of 30 October (`meta-hackathon/out/styld-clean-turn`)
 * ran them unchanged with Muse Image and Veo 3.1 Lite: the turns ended exactly on the clean picture, with prints and
 * logos kept. */

const keyColours = { green: 'green #00ff00', magenta: 'magenta #ff00ff' } as const

/** Muse: the same garment on the same wooden shoulders, turned to a strict side profile on the same canvas. */
export const profilePrompt = (key: 'green' | 'magenta') =>
  [
    'Edit only the orientation of this garment and its wooden shoulders. Rotate them together exactly 90 degrees around the vertical suspension axis. Show a strict side profile: the front surface faces right and the broad chest plane is not visible. This is not a three-quarter view.',
    `Preserve the canvas dimensions, camera, top wooden apex, garment scale, hem height, fabric, color, print and neutral lighting from the accepted front image. Keep the same flat ${keyColours[key]} background. The shoulders overlap in profile.`,
    'Do not translate or tilt the object. Do not add a metal hook, wire, rail, props or text. Produce one image.',
  ].join('\n\n')

/** Veo: one quarter-turn from the side view to the front, on a locked camera, ending on the front. */
export const turnPrompt = (key: 'green' | 'magenta') =>
  [
    'Locked studio camera. The same garment and thin wooden shoulders rotate together slowly and smoothly through exactly one quarter-turn, from strict side profile to direct front view. The top wooden suspension apex remains fixed at exactly the same screen coordinates.',
    'Motion is pure yaw around that vertical suspension axis. No pendulum swing, lateral drift, bounce, rocking, tilt, camera movement, zoom or changes in garment size. Cloth remains calm, with only minimal natural deformation. Preserve fabric color, product silhouette, seams and print. Lighting stays constant.',
    `Keep the flat ${key} background completely uniform. No hook, wire, rail, hands, mannequin, new objects or text. End at the provided front image, without overshooting or turning back.`,
  ].join('\n\n')
