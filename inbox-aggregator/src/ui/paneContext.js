import { createContext } from 'react';

// Given by MainPane to the page it shows:
// PaneInteraction: call it when the user does something on the page (clicks,
//   scrolls, types), which keeps a temporary tab open (see useNavigation).
//   EmailHtml calls it for the email's frame, whose events stay inside it.
// PaneClose: closes the page; PaneBar shows it as × on a phone, where there's
//   no tab strip.
export const PaneInteraction = createContext(null);
export const PaneClose = createContext(null);
