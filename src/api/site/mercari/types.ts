import { GoodsBreifExtension, GoodsSearchConditionBase } from "../types";

export interface GoodsListResponse {
  meta: any;
  items: Array<GoodsBreif>;
}

interface Seller {
    id: number;
    name: string;
    photo_url: string;
    photo_thumbnail_url: string;
    register_sms_confirmation: string;
    register_sms_confirmation_at: string;
    created: number;
    num_sell_items: number;
    ratings: {
        good: number;
        normal: number;
        bad: number;
    };
    num_ratings: number;
    score: number;
    is_official: boolean;
    quick_shipper: boolean;
    is_followable: boolean;
    is_blocked: boolean;
    star_rating_score: number;
}

interface ItemCategory {
    id: number;
    name: string;
    display_order: number;
    parent_category_id: number;
    parent_category_name: string;
    root_category_id: number;
    root_category_name: string;
}

interface ParentCategory {
    id: number;
    name: string;
    display_order: number;
}

interface ItemCondition {
    id: number;
    name: string;
    subname: string;
}

interface ShippingPayer {
    id: number;
    name: string;
    code: string;
}

interface ShippingMethod {
    id: number;
    name: string;
    is_deprecated: string;
}

interface ShippingFromArea {
    id: number;
    name: string;
}

interface ShippingDuration {
    id: number;
    name: string;
    min_days: number;
    max_days: number;
}

interface ShippingClass {
    id: number;
    name: string;
    description: string;
    fee: number;
    carrier: string;
    carrier_display_name: string;
    request_class_display_name: string;
    icon_id: number;
    pickup_fee: number;
    shipping_fee: number;
    total_fee: number;
    is_pickup: boolean;
}

interface TransactionEvidence {
    id: number;
    status: string;
}

export interface GoodsDetailData {
    id: string;
    seller: Seller;
    status: "sold_out" | "invalid" | "on_sale";
    name: string;
    price: number;
    description: string;
    photos: string[];
    photo_paths: string[];
    thumbnails: string[];
    item_category: ItemCategory;
    item_category_ntiers: ItemCategory;
    parent_categories_ntiers: ParentCategory[];
    item_condition: ItemCondition;
    colors: any[];
    shipping_payer: ShippingPayer;
    shipping_method: ShippingMethod;
    shipping_from_area: ShippingFromArea;
    shipping_duration: ShippingDuration;
    shipping_class: ShippingClass;
    num_likes: number;
    num_comments: number;
    registered_prices_count: number;
    comments: any[];
    updated: number;
    created: number;
    pager_id: number;
    liked: boolean;
    checksum: string;
    is_dynamic_shipping_fee: boolean;
    application_attributes: any;
    is_shop_item: string;
    hash_tags: string[];
    is_anonymous_shipping: boolean;
    is_web_visible: boolean;
    is_offerable: boolean;
    is_organizational_user: boolean;
    organizational_user_status: string;
    is_stock_item: boolean;
    is_cancelable: boolean;
    shipped_by_worker: boolean;
    transaction_evidence: TransactionEvidence;
    additional_services: any[];
    has_additional_service: boolean;
    delivery_facility_type: string;
    has_like_list: boolean;
    is_offerable_v2: boolean;
    is_dismissed: boolean;
    meta_title: string;
    meta_subtitle: string;
}

export interface GoodDetailResponse {
    result: string;
    data: GoodsDetailData;
    meta: any;
}

type GoodsSalesStatus = "STATUS_ON_SALE" | "STATUS_TRADING" | "STATUS_SOLD_OUT";

interface GoodsBreif extends GoodsBreifExtension {
  id: string,
  sellerId: string,
  buyerId: string,
  status: GoodsSalesStatus,
  name: string,
  price: string,
  created: string,
  updated: string,
  thumbnails: Array<string>,
  itemType: string,
  itemConditionId: string,
  shippingPayerId: string,
  shopName: string,
  itemSize: null,
  shippingMethodId: string,
  categoryId: string
}

export type MercariGoodsSearchCondition = GoodsSearchConditionBase & {
  excludeKeyword?: string,
  status: Array<GoodsSalesStatus>,
  categoryId?: string[],
  priceMin?: number,
  priceMax?: number,
  itemConditionId?: number[],
  shippingPayerId?: number[],
  pageSize: number;
}

