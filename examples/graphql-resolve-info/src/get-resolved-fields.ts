import { getContext } from '@getcronit/pylon';
import { GraphQLResolveInfo } from 'graphql';
import { ResolveTree, FieldsByTypeName, parseResolveInfo } from 'graphql-parse-resolve-info';

type GraphQLMappedFields = {
  flatFields: string[];
  nestedFields: { [fieldName: string]: GraphQLMappedFields; };
};
function isFlatField(tree: ResolveTree) {
  return Object.keys(tree.fieldsByTypeName).length === 0;
}
const fetchResolveInfoNestedFields = (resolvedInfo: ResolveTree | FieldsByTypeName) => {
  const resourceTreeMap: FieldsByTypeName[any] = Object.values(resolvedInfo.fieldsByTypeName)[0];
  return Object.keys(resourceTreeMap).reduce(
    (map: GraphQLMappedFields, field) => {
      if (isFlatField(resourceTreeMap[field])) {
        map.flatFields.push(field);
      } else {
        map.nestedFields[field] = fetchResolveInfoNestedFields(resourceTreeMap[field]);
      }

      return map;
    },
    { flatFields: [], nestedFields: {} }
  );
};

 const getFieldsFromResolvedInfo = (info: GraphQLResolveInfo) => {
  return fetchResolveInfoNestedFields(parseResolveInfo(info)!);
};


export const getResolvedFields = () => {
  const ctx = getContext()

  const info = ctx.get("graphqlResolveInfo")

  if(!info){
    throw new Error("This must be used inside a GraphQL operation")
  }

  return getFieldsFromResolvedInfo(info)
}