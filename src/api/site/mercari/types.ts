export interface GoodsListResponse {
  "result": string,
  "meta": any,
  "data": Array<GoodsBreif>,
}

interface GoodsBreif {
  "id": string,
  "seller": {
      "id": number,
      "name": string
  },
  "status": string,
  "name": string,
  "price": number,
  "item_condition": {
      "id": number,
      "name": string
  },
  "thumbnails": Array<string>,
  "root_category_id": number,
  "num_likes": number,
  "num_comments": number,
  "created": number,
  "updated": number,
  "item_category": {
      "id": number,
      "name": string,
      "display_order": number,
      "parent_category_id": number,
      "parent_category_name": string,
      "root_category_id": number,
      "root_category_name": string
  },
  "shipping_from_area": {
      "id": number,
      "name": string
  },
  "item_brand"?: {
    "id": number,
    "name": string,
    "sub_name": string
},
  "pager_id": number,
  "liked": boolean,
  "item_pv": number,
  "item_type": string
}