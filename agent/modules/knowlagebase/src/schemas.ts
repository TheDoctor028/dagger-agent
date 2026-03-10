import { CollectionCreateSchema } from "typesense/src/Typesense/Collections";


export const markDownDocsSchema: CollectionCreateSchema = {
    name: "markdown_docs",
    fields: [
        { name: "id",                 type: "string"   },
        { name: "title",              type: "string"   },
        { name: "section_heading",    type: "string",   optional: true },
        { name: "content",            type: "string"   },
        { name: "category",           type: "string",   facet: true },
        { name: "subcategory",        type: "string",   facet: true, optional: true },
        { name: "slug",               type: "string"   },
        { name: "tags",               type: "string[]", facet: true, optional: true },
        { name: "confluence_page_id", type: "string",   optional: true, index: false },
        { name: "headings",           type: "string[]", optional: true },
        { name: "weight",             type: "int32"    },
    ],
    default_sorting_field: "weight",
}

export const schemas: CollectionCreateSchema[] = [markDownDocsSchema]
