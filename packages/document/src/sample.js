import { validateDocument } from './validate.js';

const styles = (desktop = {}, tablet = {}, mobile = {}) => ({ desktop, tablet, mobile });
const node = (id, type, props = {}, desktop = {}, children) => ({ id, type, props, styles: styles(desktop), ...(children ? { children } : {}) });

export const samplePage = validateDocument({
  schemaVersion: 1,
  id: 'page_home',
  type: 'Page',
  props: { title: 'Northstar Studio' },
  styles: styles({ fontFamily: 'Inter, Arial, sans-serif', color: '#17233d', backgroundColor: '#f7f8fc' }),
  regions: {
    header: [
      node('header_shell', 'Layout', { label: 'Header layout' }, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '24px', padding: '24px 6vw', maxWidth: '1440px', margin: 'auto' }, [
        node('brand', 'Heading', { text: '✦ Northstar', level: 2 }, { fontSize: '24px', margin: '0', letterSpacing: '-0.04em', color: '#182b55' }),
        node('navigation', 'Container', { label: 'Navigation' }, { display: 'flex', alignItems: 'center', gap: '28px' }, [
          node('nav_work', 'Button', { text: 'Work', href: '#work' }, { color: '#263b61', fontWeight: '600' }),
          node('nav_about', 'Button', { text: 'About', href: '#about' }, { color: '#263b61', fontWeight: '600' }),
          node('nav_contact', 'Button', { text: 'Contact us', href: '#contact' }, { backgroundColor: '#172b58', color: '#ffffff', borderRadius: '999px', padding: '11px 20px', fontWeight: '700' })
        ])
      ]),
      node('announcement', 'Text', { text: 'Fresh ideas, built for what comes next.' }, { textAlign: 'center', backgroundColor: '#e9eefe', color: '#2b4b87', padding: '10px 16px', margin: '0', fontSize: '13px', fontWeight: '600' })
    ],
    main: [
      node('hero', 'Section', { label: 'Hero' }, { padding: '88px 6vw 96px', backgroundColor: '#ffffff' }, [
        node('hero_inner', 'Container', { label: 'Hero content' }, { maxWidth: '1120px', margin: 'auto', display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', alignItems: 'center', gap: '64px' }, [
          node('hero_copy', 'Container', { label: 'Introduction' }, {}, [
            node('eyebrow', 'Text', { text: 'INDEPENDENT DESIGN STUDIO' }, { color: '#5975b1', fontSize: '12px', letterSpacing: '0.18em', fontWeight: '800' }),
            node('hero_title', 'Heading', { text: 'Make room for remarkable.', level: 1 }, { fontSize: 'clamp(48px, 5.4vw, 82px)', lineHeight: '1.04', letterSpacing: '-0.06em', margin: '20px 0' }),
            node('hero_description', 'Text', { text: 'We create thoughtful digital experiences for ambitious people and the ideas they believe in.' }, { fontSize: '20px', lineHeight: '1.6', color: '#63718b', maxWidth: '560px' }),
            node('hero_action', 'Button', { text: 'Explore our work →', href: '#work' }, { display: 'inlineBlock', backgroundColor: '#4f6fdd', color: '#ffffff', borderRadius: '999px', padding: '16px 25px', marginTop: '18px', fontWeight: '700' })
          ]),
          node('hero_art', 'Container', { label: 'Visual panel' }, { minHeight: '390px', borderRadius: '32px', backgroundColor: '#dfe7ff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 24px 65px rgba(36,65,124,.12)' }, [
            node('hero_symbol', 'Heading', { text: '✦', level: 2 }, { fontSize: '180px', lineHeight: '1', color: '#6986e9', margin: '0' })
          ])
        ])
      ]),
      node('work_label', 'Text', { text: 'SELECTED WORK · 2026' }, { textAlign: 'center', padding: '56px 16px 0', color: '#6980ac', letterSpacing: '0.18em', fontWeight: '800', fontSize: '12px', margin: '0' }),
      node('work_heading', 'Heading', { text: 'Built with purpose.', level: 2 }, { textAlign: 'center', fontSize: '42px', letterSpacing: '-0.04em', margin: '12px 0 40px' }),
      node('work_cards', 'Layout', { label: 'Feature columns' }, { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '22px', maxWidth: '1120px', margin: '0 auto', padding: '0 24px 88px' }, [
        node('card_one', 'Container', { label: 'Strategy' }, { padding: '34px', borderRadius: '24px', backgroundColor: '#ffffff' }, [node('card_one_title', 'Heading', { text: '01 / Strategy', level: 3 }, { fontSize: '22px' }), node('card_one_text', 'Text', { text: 'Clarity for your next big move.' }, { color: '#697790', lineHeight: '1.5' })]),
        node('card_two', 'Container', { label: 'Design' }, { padding: '34px', borderRadius: '24px', backgroundColor: '#ffffff' }, [node('card_two_title', 'Heading', { text: '02 / Design', level: 3 }, { fontSize: '22px' }), node('card_two_text', 'Text', { text: 'Distinctive experiences that feel effortless.' }, { color: '#697790', lineHeight: '1.5' })]),
        node('card_three', 'Container', { label: 'Launch' }, { padding: '34px', borderRadius: '24px', backgroundColor: '#ffffff' }, [node('card_three_title', 'Heading', { text: '03 / Launch', level: 3 }, { fontSize: '22px' }), node('card_three_text', 'Text', { text: 'A confident start, built to grow.' }, { color: '#697790', lineHeight: '1.5' })])
      ])
    ],
    footer: [
      node('footer_grid', 'Layout', { label: 'Footer columns' }, { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '48px', maxWidth: '1120px', margin: 'auto', padding: '64px 24px' }, [
        node('footer_brand', 'Container', { label: 'Brand column' }, {}, [node('footer_logo', 'Heading', { text: '✦ Northstar', level: 2 }, { color: '#ffffff', fontSize: '24px' }), node('footer_intro', 'Text', { text: 'Ideas with direction. Experiences with feeling.' }, { color: '#b9c6e0', lineHeight: '1.6' })]),
        node('footer_links', 'Container', { label: 'Explore column' }, {}, [node('footer_links_title', 'Heading', { text: 'Explore', level: 3 }, { color: '#ffffff', fontSize: '16px' }), node('footer_links_text', 'Text', { text: 'Work · Studio · Journal' }, { color: '#b9c6e0' })]),
        node('footer_contact', 'Container', { label: 'Contact column' }, {}, [node('footer_contact_title', 'Heading', { text: 'Say hello', level: 3 }, { color: '#ffffff', fontSize: '16px' }), node('footer_email', 'Text', { text: 'hello@northstar.example' }, { color: '#b9c6e0' })])
      ])
    ]
  }
});
