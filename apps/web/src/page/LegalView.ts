import { format, type Locale, type MessageKey } from '@styld/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { styled } from '../Styled.ts'
import { legalPage, legalSection, legalUpdated } from './LegalView.styles.ts'

// The privacy policy and the terms of use: static words from the catalogs, the same signed in or out. They hold no
// state and send no Messages, so either view draws for any page's Message type.

type Section = Readonly<{ heading: MessageKey; paragraphs: ReadonlyArray<MessageKey> }>
type LegalDocument = Readonly<{ title: MessageKey; sections: ReadonlyArray<Section>; contact: string }>

export const privacyDocument: LegalDocument = {
  title: 'legal.privacyTitle',
  contact: 'privacy@styld.app',
  sections: [
    { heading: 'legal.privacy.whoHeading', paragraphs: ['legal.privacy.who'] },
    {
      heading: 'legal.privacy.collectHeading',
      paragraphs: [
        'legal.privacy.collectAccount',
        'legal.privacy.collectContent',
        'legal.privacy.collectPayment',
        'legal.privacy.collectTechnical',
      ],
    },
    { heading: 'legal.privacy.useHeading', paragraphs: ['legal.privacy.use'] },
    { heading: 'legal.privacy.privateHeading', paragraphs: ['legal.privacy.private', 'legal.privacy.sharing'] },
    { heading: 'legal.privacy.aiHeading', paragraphs: ['legal.privacy.ai', 'legal.privacy.aiProviders'] },
    { heading: 'legal.privacy.providersHeading', paragraphs: ['legal.privacy.providers', 'legal.privacy.noSale'] },
    { heading: 'legal.privacy.assistantsHeading', paragraphs: ['legal.privacy.assistants'] },
    { heading: 'legal.privacy.cookiesHeading', paragraphs: ['legal.privacy.cookies', 'legal.privacy.telemetry'] },
    { heading: 'legal.privacy.rightsHeading', paragraphs: ['legal.privacy.rights'] },
    { heading: 'legal.privacy.retentionHeading', paragraphs: ['legal.privacy.retention'] },
    { heading: 'legal.privacy.transfersHeading', paragraphs: ['legal.privacy.transfers'] },
    { heading: 'legal.privacy.childrenHeading', paragraphs: ['legal.privacy.children'] },
    { heading: 'legal.privacy.changesHeading', paragraphs: ['legal.privacy.changes'] },
  ],
}

export const termsDocument: LegalDocument = {
  title: 'legal.termsTitle',
  contact: 'hello@styld.app',
  sections: [
    { heading: 'legal.terms.serviceHeading', paragraphs: ['legal.terms.agree', 'legal.terms.service'] },
    { heading: 'legal.terms.accountsHeading', paragraphs: ['legal.terms.accounts'] },
    { heading: 'legal.terms.creditsHeading', paragraphs: ['legal.terms.credits', 'legal.terms.plans'] },
    { heading: 'legal.terms.contentHeading', paragraphs: ['legal.terms.content', 'legal.terms.ownPhotos'] },
    { heading: 'legal.terms.generatedHeading', paragraphs: ['legal.terms.generated'] },
    { heading: 'legal.terms.useHeading', paragraphs: ['legal.terms.use'] },
    { heading: 'legal.terms.propertyHeading', paragraphs: ['legal.terms.property'] },
    { heading: 'legal.terms.liabilityHeading', paragraphs: ['legal.terms.liability'] },
    { heading: 'legal.terms.endingHeading', paragraphs: ['legal.terms.ending'] },
    { heading: 'legal.terms.changesHeading', paragraphs: ['legal.terms.changes'] },
  ],
}

const sectionView = <M>(section: Section, locale: Locale, h: HtmlBuilder<M>): Html =>
  h.section(styled(h, legalSection()), [
    h.h2([], [format(locale, section.heading, {})]),
    ...section.paragraphs.map((paragraph) => h.p([], [format(locale, paragraph, {})])),
  ])

/** A legal page: its title and date, its sections, and the address that answers questions about it. */
export const legalView = <M>(document: LegalDocument, locale: Locale, h: HtmlBuilder<M>): Html =>
  h.main(
    [h.Id('main'), ...styled(h, legalPage())],
    [
      h.h1([], [format(locale, document.title, {})]),
      h.p(styled(h, legalUpdated()), [format(locale, 'legal.updated', {})]),
      ...document.sections.map((section) => sectionView(section, locale, h)),
      h.p(
        [],
        [format(locale, 'legal.questions', {}), ' ', h.a([h.Href(`mailto:${document.contact}`)], [document.contact])],
      ),
    ],
  )
