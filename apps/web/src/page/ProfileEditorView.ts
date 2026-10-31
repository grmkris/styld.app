import { format, type Locale } from '@styld/i18n'
import { type Profile, Tone } from '@styld/protocol'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../ActionButton.ts'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { avatar } from '../Avatar.ts'
import { checkNotice } from './CheckNotice.ts'
import { textField } from '../Fields.styles.ts'
import { loader } from '../Icon.ts'
import { block, line } from '../Skeleton.styles.ts'
import { styled } from '../Styled.ts'
import { visuallyHidden } from '../VisuallyHidden.styles.ts'
import { cx } from 'zyzz'
import { Load, Message, type Model, Publishing, Saving } from './ProfileEditor.ts'
import * as styles from './ProfileEditorView.styles.ts'

const savingView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Saving.match(model.saving, {
    Idle: () => h.empty,
    Saving: () => h.span([h.Role('status'), ...styled(h, styles.note())], [loader(h)]),
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
        h.Attribute('maxlength', String(attributes.maxLength)),
        ...(attributes.placeholder === undefined ? [] : [h.Placeholder(attributes.placeholder)]),
        h.OnInput(onInput),
      ]),
    ],
  )

const toneView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.fieldset(
    [h.Role('radiogroup'), h.AriaLabel(format(locale, 'profile.editor.toneLabel', {})), ...styled(h, styles.tones())],
    Tone.literals.map((tone) =>
      h.button(
        [
          h.Type('button'),
          h.Role('radio'),
          h.AriaChecked(model.draft.tone === tone),
          h.AriaLabel(format(locale, `profile.tones.${tone}`, {})),
          ...styled(h, styles.tone()),
          h.OnClick(Message.ChoseTone({ tone })),
        ],
        [avatar(model.draft.name, tone, 'medium', h)],
      ),
    ),
  )

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
              h.Attribute('maxlength', '30'),
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
        { maxLength: 60 },
        h,
      ),
      textInput(
        'profile-city',
        format(locale, 'profile.editor.cityLabel', {}),
        model.draft.city,
        (value) => Message.UpdatedField({ field: 'city', value }),
        { maxLength: 60 },
        h,
      ),
      textInput(
        'profile-bio',
        format(locale, 'profile.editor.bioLabel', {}),
        model.draft.bio,
        (value) => Message.UpdatedField({ field: 'bio', value }),
        { maxLength: 160, placeholder: format(locale, 'profile.editor.bioPlaceholder', {}) },
        h,
      ),
      toneView(model, locale, h),
      h.label(
        [h.For('profile-wardrobe'), ...styled(h, styles.check())],
        [
          h.input([
            h.Id('profile-wardrobe'),
            h.Type('checkbox'),
            h.Checked(model.draft.wardrobeShown),
            h.OnChange(() => Message.ToggledWardrobeShown({ shown: !model.draft.wardrobeShown })),
          ]),
          format(locale, 'profile.editor.wardrobeShown', {}),
        ],
      ),
      h.div(styled(h, styles.actions()), [
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

const publicView = (profile: Profile, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const sending = Publishing.guards.Sending(model.publishing)
  return h.section(
    [h.AriaLabelledBy('profile-public'), ...styled(h, styles.publicCard())],
    [
      h.h2(
        [h.Id('profile-public')],
        [format(locale, profile.published ? 'profile.editor.statusPublic' : 'profile.editor.statusPrivate', {})],
      ),
      profile.handle === null
        ? h.p(styled(h, styles.note()), [format(locale, 'profile.editor.needUsername', {})])
        : h.p(styled(h, styles.note()), [
            profile.published
              ? `@${profile.handle}`
              : format(locale, 'profile.card.private', { username: profile.handle }),
          ]),
      profile.published ? checkNotice(profile.check, locale, h) : h.empty,
      Publishing.match(model.publishing, {
        Idle: () => h.empty,
        Sending: () => h.p([h.Role('status')], [loader(h)]),
        Failed: ({ needsHandle }) =>
          h.p(
            [h.Role('alert'), ...styled(h, styles.problem())],
            [format(locale, needsHandle ? 'profile.editor.needUsername' : 'profile.editor.saveFailed', {})],
          ),
      }),
      h.div(styled(h, styles.actions()), [
        actionButton(
          {
            label: format(locale, profile.published ? 'profile.editor.unpublish' : 'profile.editor.publish', {}),
            style: profile.published ? secondaryAction() : primaryAction(),
            isDisabled: sending || profile.handle === null,
            onClick: Message.ClickedPublish({ published: !profile.published }),
          },
          h,
        ),
      ]),
    ],
  )
}

const skeletonFields = ['handle', 'name', 'city', 'bio'] as const

/** The editor's shape while the profile loads: the avatar and title, then a label over a field for each of the four,
 * and what is loading for assistive technology. */
const loadingView = (locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  h.p([h.Role('status'), ...styled(h, visuallyHidden())], [format(locale, 'common.loading', {})]),
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
    Load.match(model.load, {
      Loading: () => loadingView(locale, h),
      Failed: () => [
        h.p([h.Role('alert')], [format(locale, 'profile.editor.saveFailed', {})]),
        actionButton(
          { label: format(locale, 'studio.retry', {}), style: secondaryAction(), onClick: Message.ClickedRetry() },
          h,
        ),
      ],
      Ready: ({ profile }) => [
        h.div(styled(h, styles.who()), [
          avatar(model.draft.name, model.draft.tone, 'large', h),
          h.h1([], [format(locale, 'profile.editor.title', {})]),
        ]),
        formView(model, locale, h),
        publicView(profile, model, locale, h),
      ],
    }),
  ),
)
