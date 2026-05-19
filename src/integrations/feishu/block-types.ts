export type FeishuBlockType =
  | 1   // page
  | 2   // text
  | 3   // heading1
  | 4   // heading2
  | 5   // heading3
  | 6   // heading4
  | 7   // heading5
  | 8   // heading6
  | 9   // heading7
  | 10  // heading8
  | 11  // heading9
  | 12  // bullet
  | 13  // ordered
  | 14  // code
  | 15  // quote
  | 16  // todo
  | 17  // bitable
  | 18  // callout
  | 21  // divider
  | 22  // file
  | 23  // grid
  | 24  // grid_column
  | 27  // image
  | 28  // iframe
  | 29  // group
  | 30  // sheet (inline spreadsheet)
  | 31  // widget
  | 33  // mindmap
  | 34  // table
  | 999; // unknown/unhandled

export type FeishuTextElementStyle = {
  bold?: boolean;
  inline_code?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  link?: { url: string };
};

export type FeishuTextElement = {
  text_run?: {
    content: string;
    text_element_style?: FeishuTextElementStyle;
  };
  mention?: {
    user_id: string;
    name: string;
  };
  equation?: {
    content: string;
  };
};

export type FeishuTextStyle = {
  align?: number;
  folded?: boolean;
};

export type FeishuBlock = {
  block_id: string;
  block_type: FeishuBlockType;
  parent_id?: string;
  children?: string[];

  page?: {
    elements?: FeishuTextElement[];
    style?: FeishuTextStyle;
  };
  text?: {
    elements?: FeishuTextElement[];
    style?: FeishuTextStyle;
  };
  heading1?: {
    elements?: FeishuTextElement[];
    style?: FeishuTextStyle;
  };
  heading2?: {
    elements?: FeishuTextElement[];
    style?: FeishuTextStyle;
  };
  heading3?: {
    elements?: FeishuTextElement[];
    style?: FeishuTextStyle;
  };
  heading4?: {
    elements?: FeishuTextElement[];
    style?: FeishuTextStyle;
  };
  heading5?: {
    elements?: FeishuTextElement[];
    style?: FeishuTextStyle;
  };
  heading6?: {
    elements?: FeishuTextElement[];
    style?: FeishuTextStyle;
  };
  heading7?: {
    elements?: FeishuTextElement[];
    style?: FeishuTextStyle;
  };
  heading8?: {
    elements?: FeishuTextElement[];
    style?: FeishuTextStyle;
  };
  heading9?: {
    elements?: FeishuTextElement[];
    style?: FeishuTextStyle;
  };
  bullet?: {
    elements?: FeishuTextElement[];
    style?: FeishuTextStyle;
  };
  ordered?: {
    elements?: FeishuTextElement[];
    style?: FeishuTextStyle;
  };
  code?: {
    elements?: FeishuTextElement[];
    style?: FeishuTextStyle;
    language?: number;
  };
  quote?: {
    elements?: FeishuTextElement[];
    style?: FeishuTextStyle;
  };
  todo?: {
    elements?: FeishuTextElement[];
    style?: FeishuTextStyle;
    done?: boolean;
  };
  callout?: {
    elements?: FeishuTextElement[];
    style?: FeishuTextStyle;
  };
  image?: {
    token: string;
    width?: number;
    height?: number;
    align?: number;
    scale?: number;
  };
  sheet?: {
    token: string;
  };
  bitable?: {
    token: string;
  };
  divider?: Record<string, unknown>;
  grid?: {
    columns?: number;
  };
  grid_column?: Record<string, unknown>;
  iframe?: {
    url?: string;
    title?: string;
  };
  file?: {
    token?: string;
    name?: string;
    type?: string;
  };
  group?: Record<string, unknown>;
  table?: {
    row_size?: number;
    col_size?: number;
    rows?: FeishuTableRow[];
  };
  mindmap?: Record<string, unknown>;
  widget?: Record<string, unknown>;
};

export type FeishuTableRow = {
  row_id?: string;
  cells?: FeishuTableCell[];
};

export type FeishuTableCell = {
  col_id?: string;
  elements?: FeishuTextElement[];
  merge_type?: number;
};

export type FeishuBlocksResponse = {
  has_more: boolean;
  page_token?: string;
  items: FeishuBlock[];
};