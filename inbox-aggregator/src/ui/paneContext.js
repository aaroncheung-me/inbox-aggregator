import { createContext } from 'react';

// Given by MainPane to the page it shows, and drawn by PaneBar:
// PaneClose: closes the page, as × at the end of its bar. Shown on a phone,
//   where there's no tab strip, and on the page beside the email being written.
// PaneBeside: puts this page beside the email being written ("Show beside";
//   desktop, while one is being written).
// PaneSwap: on the page beside the email being written, moves it to the
//   other side (⇄).
export const PaneClose = createContext(null);
export const PaneBeside = createContext(null);
export const PaneSwap = createContext(null);
