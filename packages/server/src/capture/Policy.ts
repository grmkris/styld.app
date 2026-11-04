// Every bar the garment pipeline and the picture jobs hold the decision model's answers to, and every cap on what one
// picture yields, in one place. Each is a constant: changing one is a commit. One bar per question: where two features
// ask Clef the same question about the same kind of pictures, they hold its answer to the same bar.

/** How captures are processed: single garments are cut out by Cloudflare, several by SAM, and every SAM mask's edge
 * is refined against the photo (`Matte.ts`). */
export interface CapturePolicy {
  /** How sure the decision model must be before a photo counts as one garment, or none. */
  readonly routeConfidence: number
  /** How likely a person must show (0–1) before a photo counts as showing one: someone wearing or holding the clothes,
   * or only a hand. */
  readonly person: number
  /** How sure it must be that a garment is held up before the camera shoots. */
  readonly heldConfidence: number
  /** How sure it must be that a camera shot shows the same garment as the last one: its back, a different view of it,
   * so a lower bar than two sightings of one side (`matching.same`). */
  readonly samePieceConfidence: number
  /** What one picture yields (`Garments.ts`). */
  readonly garments: {
    /** Specks are ignored: a garment covers at least this share of the picture. */
    readonly minimumShare: number
    /** A mask mostly covered (above this share) by a mask of an earlier prompt is the same garment found again. */
    readonly overlap: number
    /** How likely a cut-out is one whole garment (Clef's `whole`). On 119 cut-outs from real videos (2026-10-30: a
     * rail filmed close up, a try-on video, garments held up, a drawn rail), 15 of the 16 usable pieces scored at least
     * 0.5 and the 16th 0.497; 93 of the 103 others scored under 0.2. Under `drop` it is a scrap; from `preselect` it
     * is offered ticked; between, offered unticked as part of one. */
    readonly whole: { readonly drop: number; readonly preselect: number }
    /** Two shoes of one pair are one piece: two cut-outs of one pair kind, the smaller at least this share of the
     * larger's area. */
    readonly pairArea: number
    /** At most this many pieces from one picture, the largest first: each costs a description and a store. A photo
     * or video for the tray holds a whole rail; an outfit photo shows what one person wears. */
    readonly pieces: { readonly tray: number; readonly video: number; readonly gallery: number }
    /** An outfit photo is of the person nearest the camera; a garment is theirs when at least `worn` of its mask lies
     * on the person's mask, or, for a bag, when its middle lies inside the person's box widened by `carried` of its
     * width on each side (a bag on a strap hangs beside the body). Eva's review (2 November, F-16): with no person
     * chosen, a bystander's unblocked shirt outscored her half-hidden dress. */
    readonly worn: number
    readonly carried: number
  }
  /** Clean pictures drawn from kept cut-outs (owner, 30 October): a drawing at least `reject` like the cut-out is
   * shown, and below it is dropped. A cut-out at least `face` likely to show a face is never sent on. Until 4 November
   * a drawing under 0.8 was only proposed, for the person to choose below the piece's facts; of a tester's 58
   * drawings 8 were shown, 42 waited unseen, 4 were dropped and 4 failed, so to her Styld "only cuts them out". The
   * owner chose to show every drawing that passes the reject bar, with the person's photo one swipe away (4 November):
   * the middle is gone, and a drawing proposed before then shows as one that passed (`wardrobe/Shown.ts`). */
  readonly pictures: {
    readonly reject: number
    readonly face: number
  }
  /** How a garment seen more than once becomes one card (2026-10-31), and how a worn garment is matched with a piece:
   * Clef's answer to "the same garment?" at or above `same` joins a sighting to another of the import, takes it for a
   * piece already in the wardrobe, or suggests the piece an outfit photo shows. A sighting is compared with at most
   * `sightings` others of its kind and `pieces` of the wardrobe's. On the person-routing spike's two real videos, 0.8
   * halved the cards with no false merge (30 October); different garments scored up to 0.76, so a lower bar would
   * suggest the wrong piece. */
  readonly matching: {
    readonly same: number
    readonly sightings: number
    readonly pieces: number
    /** An outfit photo's garment is compared with more of the wardrobe's pieces: worn and partly hidden, its colour
     * is a weaker guide to which of many like pieces it is. */
    readonly photoPieces: number
  }
  /** The floors every checked frame of a turn must reach, beside the clean picture, for the turn to be kept: colour
   * and logo or print (the 30 October comparison's gate, which every good take passed and the drifting models
   * failed). */
  readonly turns: {
    readonly colour: number
    readonly print: number
  }
}

/** The policy the Worker runs. */
export const capturePolicy: CapturePolicy = {
  routeConfidence: 0.75,
  person: 0.5,
  heldConfidence: 0.6,
  samePieceConfidence: 0.6,
  garments: {
    minimumShare: 0.004,
    overlap: 0.5,
    whole: { drop: 0.2, preselect: 0.5 },
    pairArea: 0.5,
    pieces: { tray: 20, video: 20, gallery: 8 },
    worn: 0.5,
    carried: 0.25,
  },
  pictures: { reject: 0.5, face: 0.3 },
  matching: { same: 0.8, sightings: 10, pieces: 6, photoPieces: 12 },
  turns: { colour: 0.8, print: 0.6 },
}
