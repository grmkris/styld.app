import { format, type Locale } from '@styld/i18n'
import { type Profile, Tone, textLength } from '@styld/protocol'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../ActionButton.ts'
import { linkAction, primaryAction, secondaryAction, smallAction } from '../Actions.styles.ts'
import { avatar } from '../Avatar.ts'
import { avatar as avatarStyle } from '../Avatar.styles.ts'
import { checkNotice } from './CheckNotice.ts'
import { textArea, textField } from '../Fields.styles.ts'
import { personRouter } from '../route.ts'
import { loader } from '../Icon.ts'
import { block, line } from '../Skeleton.styles.ts'
import { styled } from '../Styled.ts'
import { visuallyHidden } from '../VisuallyHidden.styles.ts'
import { cx } from 'zyzz'
import { Message, type Model, Publishing, Saving } from './ProfileEditor.ts'
import { retryView } from './Retry.ts'
import * as styles from './ProfileEditorView.styles.ts'
import { loadingStatus } from '../Loading.ts'

const savingView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Saving.match(model.saving, {
    Idle: () => h.empty,
    Saving: () =>
      h.span([h.Role('status'), ...styled(h, styles.note())], [loader(h), format(locale, 'profile.editor.saving', {})]),
    Saved: () => h.span([h.Role('status'), ...styled(h, styles.note())], [format(locale, 'profile.editor.saved', {})]),
    Failed: ({ problem }) =>
      h.p(
        [h.Role('alert'), ...styled(h, styles.problem())],
        [
          format(
            locale,
            problem === 'taken'
              ? 'profile.editor.usernameStatus.taken'
              : problem === 'reserved'
                ? 'profile.editor.usernameStatus.reserved'
                : problem === 'invalid'
                  ? 'profile.editor.usernameStatus.invalid'
                  : 'profile.editor.saveFailed',
            {},
          ),
        ],
      ),
  })

const textInput = (
  id: string,
  label: string,
  value: string,
  onInput: (value: string) => Message,
  attributes: { readonly maxLength: number; readonly placeholder?: string },
  h: HtmlBuilder<Message>,
): Html =>
  h.label(
    [h.For(id), ...styled(h, styles.field())],
    [
      label,
      h.input([
        h.Id(id),
        ...styled(h, textField()),
        h.Value(value),
        h.Maxlength(attributes.maxLength),
        ...(attributes.placeholder === undefined ? [] : [h.Placeholder(attributes.placeholder)]),
        h.OnInput(onInput),
      ]),
    ],
  )

/** The bio in a box that shows all of it while it is written, with how much of the 160 is used. */
const bioView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.label(
    [h.For('profile-bio'), ...styled(h, styles.field())],
    [
      format(locale, 'profile.editor.bioLabel', {}),
      h.textarea([
        h.Id('profile-bio'),
        h.Rows(3),
        h.Value(model.draft.bio),
        h.Maxlength(textLength.bio),
        h.AriaDescribedBy('profile-bio-count'),
        h.Placeholder(format(locale, 'profile.editor.bioPlaceholder', {})),
        ...styled(h, cx(textField(), textArea())),
        h.OnInput((value) => Message.UpdatedField({ field: 'bio', value })),
      ]),
      h.span(
        [h.Id('profile-bio-count'), ...styled(h, styles.count())],
        [format(locale, 'profile.editor.bioCount', { count: model.draft.bio.length, most: 160 })],
      ),
    ],
  )

/** The avatar's colour: a named group of native radios, so arrow keys move between them, each drawn as its tone. The
 * large avatar above shows the initials on the chosen one. */
const toneView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.fieldset(styled(h, styles.tones()), [
    h.legend(styled(h, styles.legend()), [format(locale, 'profile.editor.toneLabel', {})]),
    h.div(
      styled(h, styles.toneRow()),
      Tone.literals.map((tone) =>
        h.keyed('label')(tone, styled(h, styles.tone()), [
          h.input([
            h.Type('radio'),
            h.Name('profile-tone'),
            h.Value(tone),
            h.Checked(model.draft.tone === tone),
            h.AriaLabel(format(locale, `profile.tones.${tone}`, {})),
            ...styled(h, visuallyHidden()),
            h.OnChange(() => Message.ChoseTone({ tone })),
          ]),
          h.span([h.DataAttribute('tone', tone), ...styled(h, cx(avatarStyle(), styles.swatch()))]),
        ]),
      ),
    ),
  ])

const formView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.form(
    [h.OnSubmit(Message.SubmittedProfile()), h.Attribute('novalidate', ''), ...styled(h, styles.form())],
    [
      h.label(
        [h.For('profile-handle'), ...styled(h, styles.field())],
        [
          format(locale, 'profile.editor.usernameLabel', {}),
          h.span(styled(h, styles.handleRow()), [
            '@',
            h.input([
              h.Id('profile-handle'),
              ...styled(h, textField()),
              h.Value(model.draft.handle),
              h.Maxlength(textLength.handle),
              h.Attribute('autocapitalize', 'none'),
              h.Attribute('spellcheck', 'false'),
              h.Placeholder(format(locale, 'profile.editor.usernamePlaceholder', {})),
              h.OnInput((value) => Message.UpdatedField({ field: 'handle', value })),
            ]),
          ]),
          h.span(styled(h, styles.hint()), [format(locale, 'profile.editor.usernameHint', {})]),
        ],
      ),
      textInput(
        'profile-name',
        format(locale, 'profile.editor.nameLabel', {}),
        model.draft.name,
        (value) => Message.UpdatedField({ field: 'name', value }),
        { maxLength: textLength.profileName },
        h,
      ),
      textInput(
        'profile-city',
        format(locale, 'profile.editor.cityLabel', {}),
        model.draft.city,
        (value) => Message.UpdatedField({ field: 'city', value }),
        { maxLength: textLength.city },
        h,
      ),
      bioView(model, locale, h),
      toneView(model, locale, h),
      // Save is the form's one action, full width at its end (DESIGN › Controls › Primary).
      h.div(styled(h, styles.save()), [
        actionButton(
          {
            label: format(locale, 'studio.save', {}),
            style: primaryAction(),
            type: 'submit',
            isDisabled: Saving.guards.Saving(model.saving),
          },
          h,
        ),
        savingView(model, locale, h),
      ]),
    ],
  )

/** Where the profile stands, in one quiet line under the title (DESIGN › Your public things), Styld's check once it
 * is public, the way to the page, and making it public or private. */
const publicView = (profile: Profile, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const sending = Publishing.guards.Sending(model.publishing)
  return h.div(styled(h, styles.standing()), [
    h.p(styled(h, styles.note()), [
      profile.handle === null
        ? format(locale, 'profile.card.setUp', {})
        : format(locale, profile.published ? 'profile.card.public' : 'profile.card.private', {
            username: profile.handle,
          }),
    ]),
    // What making it public shows, now that the wardrobe is never on it (owner, 2026-10-31).
    h.p(styled(h, styles.note()), [format(locale, 'profile.card.shows', {})]),
    profile.published ? checkNotice(profile.check, locale, h) : h.empty,
    Publishing.match(model.publishing, {
      Idle: () => h.empty,
      Sending: () =>
        h.p(
          [h.Role('status'), ...styled(h, styles.note())],
          [loader(h), format(locale, 'profile.editor.publishing', {})],
        ),
      Failed: ({ needsHandle }) =>
        h.p(
          [h.Role('alert'), ...styled(h, styles.problem())],
          [format(locale, needsHandle ? 'profile.editor.needUsername' : 'profile.editor.saveFailed', {})],
        ),
    }),
    h.div(styled(h, styles.actions()), [
      profile.published && profile.handle !== null
        ? h.a(
            [h.Href(personRouter({ handle: profile.handle })), ...styled(h, linkAction())],
            [format(locale, 'profile.card.viewPage', {})],
          )
        : h.empty,
      actionButton(
        {
          label: format(locale, profile.published ? 'profile.editor.unpublish' : 'profile.editor.publish', {}),
          style: cx(secondaryAction(), smallAction()),
          isDisabled: sending || profile.handle === null,
          onClick: Message.ClickedPublish({ published: !profile.published }),
        },
        h,
      ),
    ]),
  ])
}

const skeletonFields = ['handle', 'name', 'city', 'bio'] as const

/** The editor's shape while the profile loads: the avatar and title, then a label over a field for each of the four,
 * and what is loading for assistive technology. */
const loadingView = (locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  loadingStatus(format(locale, 'common.loading', {}), h),
  h.div(
    [h.AriaHidden(true), h.DataAttribute('skeleton', ''), ...styled(h, styles.who())],
    [h.span(styled(h, cx(block(), styles.avatarSkeleton()))), h.span(styled(h, cx(line(), styles.titleSkeleton())))],
  ),
  h.div(
    [h.AriaHidden(true), h.DataAttribute('skeleton', ''), ...styled(h, styles.form())],
    skeletonFields.map((slot) =>
      h.keyed('span')(slot, styled(h, styles.field()), [
        h.span(styled(h, cx(line(), styles.labelSkeleton()))),
        h.span(styled(h, cx(block(), styles.fieldSkeleton()))),
      ]),
    ),
  ),
]

/** The profile editor: who you are to others, then whether they can see it. */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  h.main(
    [h.Id('main'), ...styled(h, styles.page())],
    AsyncData.matchData(model.profile, {
      onEmpty: () => loadingView(locale, h),
      onFailure: () => [retryView(format(locale, 'profile.card.loadFailed', {}), locale, Message.ClickedRetry(), h)],
      onData: (profile) => [
        h.div(styled(h, styles.who()), [
          avatar(model.draft.name, model.draft.tone, 'large', h),
          h.h1([], [format(locale, 'profile.editor.title', {})]),
        ]),
        publicView(profile, model, locale, h),
        formView(model, locale, h),
      ],
    }),
  ),
)
