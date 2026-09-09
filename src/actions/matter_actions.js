const samples = require('../samples/static_samples.json');
const {
    getSuccessfulData,
    getSuccessfulRows,
} = require('../efimis_response');
const { buildEfimisApiUrl } = require('../efimis_url');

const MATTER_BODY_FIELDS = [
    'title',
    'divisionId',
    'matterTypeId',
    'clientId',
    'billingContactId',
];

const buildMatterBody = (inputData, preserveNull) =>
    Object.fromEntries(
        MATTER_BODY_FIELDS
            .map((key) => [key, inputData[key]])
            .filter(([, value]) => {
                if (value === undefined || value === '') {
                    return false;
                }
                return preserveNull || value !== null;
            }),
    );

const getMatterById = async (z, bundle, id, operation) => {
    const getResponse = await z.request({
        url: buildEfimisApiUrl(bundle, 'matters', id),
        method: 'GET',
    });
    getResponse.throwForStatus();
    return getSuccessfulData(getResponse.json, operation);
};

module.exports = {
    searches: [{
        key: 'apiV1MattersGet',
        noun: 'Matter',
        display: {
            label: 'Find matter(s)',
            description: 'Finds matters based on the specified criteria.',
            hidden: false,
        },
        operation: {
            sample: samples.apiV1MattersGet,
            inputFields: [
                {
                    key: 'pageIndex',
                    label: 'Page Index',
                    type: 'integer',
                },
                {
                    key: 'pageSize',
                    label: 'Page Size',
                    type: 'integer',
                },
                {
                    key: 'keywords',
                    label: 'Keywords',
                    type: 'string',
                },
            ],
            perform: async (z, bundle) => {
                z.console.log('Finding Efimis matters');
                const options = {
                    url: buildEfimisApiUrl(bundle, 'matters'),
                    method: 'GET',
                    removeMissingValuesFrom: { params: true, body: true },
                    params: {
                        'pageIndex': bundle.inputData?.['pageIndex'],
                        'pageSize': bundle.inputData?.['pageSize'],
                        'keywords': bundle.inputData?.['keywords'],
                    },
                }
                return z.request(options).then((response) => {
                    response.throwForStatus();
                    const results = response.json;
                    return getSuccessfulRows(results, 'Find matters');
                })
            },
        }
    },
    {
        key: 'apiV1MatterGetById',
        noun: 'Matter',
        display: {
            label: 'Get a matter',
            description: 'Retrieves a matter by Id from Efimis',
            hidden: false,
        },
        operation: {
            sample: samples.apiV1MatterGetById,
            inputFields: [
                {
                    key: 'id',
                    label: 'Matter ID',
                    type: 'string',
                    required: true,
                    dynamic: 'matterList.id.name',
                },
            ],

            perform: async (z, bundle) => {
                const options = {
                    url: buildEfimisApiUrl(bundle, 'matters', bundle.inputData.id),
                    method: 'GET'
                }
                return z.request(options).then((response) => {
                    response.throwForStatus();
                    const results = response.json;
                    return [getSuccessfulData(results, 'Get matter')];
                })
            },
        }
    }
    ],
    creates: [
        {
            key: 'apiV1MatterCreate',
            noun: 'Matter',
            display: {
                label: 'Create a matter',
                description: 'Creates a new matter in Efimis',
            },
            operation: {
                sample: samples.apiV1MatterCreate,
                inputFields: [
                    {
                        key: 'title',
                        label: 'Matter Title',
                        type: 'string',
                        required: true,
                    },
                    {
                        key: 'divisionId',
                        label: 'Division',
                        dynamic: 'divisionList.id.name'
                    },
                    {
                        key: 'matterTypeId',
                        label: 'Matter Type',
                        dynamic: 'matterTypeList.id.name'
                    },
                    {
                        key: 'clientId',
                        label: 'Client',
                        type: 'string',
                        required: false,
                        dynamic: 'clientList.id.name',
                    },
                    {
                        key: 'billingContactId',
                        label: 'Billing Contact',
                        type: 'string',
                        required: false,
                        dynamic: 'entityList.id.name',
                    },
                ],
                perform: async (z, bundle) => {
                    const options = {
                        url: buildEfimisApiUrl(bundle, 'matters'),
                        method: 'POST',
                        body: buildMatterBody(bundle.inputData, false),
                    }
                    return z.request(options).then((response) => {
                        response.throwForStatus();
                        return getSuccessfulData(response.json, 'Create matter');
                    })
                },
            }
        },
        {
            key: 'apiV1MatterUpdate',
            noun: 'Matter',
            display: {
                label: 'Update a matter',
                description: 'Updates an existing matter in Efimis',
            },
            operation: {
                sample: samples.apiV1MatterUpdate,
                inputFields: [
                    {
                        key: 'id',
                        label: 'Matter ID',
                        type: 'string',
                        required: true,
                        dynamic: 'matterList.id.name',
                    },
                    {
                        key: 'title',
                        label: 'Matter Title',
                        type: 'string',
                        required: false,
                    },
                    {
                        key: 'divisionId',
                        label: 'Division',
                        dynamic: 'divisionList.id.name',
                    },
                    {
                        key: 'matterTypeId',
                        label: 'Matter Type',
                        dynamic: 'matterTypeList.id.name',
                        required: false,
                    },
                    {
                        key: 'clientId',
                        label: 'Client',
                        type: 'string',
                        required: false,
                        dynamic: 'clientList.id.name',
                    },
                    {
                        key: 'billingContactId',
                        label: 'Billing Contact',
                        type: 'string',
                        required: false,
                        dynamic: 'entityList.id.name',
                    },
                ],
                perform: async (z, bundle) => {
                    const options = {
                        url: buildEfimisApiUrl(bundle, 'matters', bundle.inputData.id),
                        method: 'PATCH',
                        body: buildMatterBody(bundle.inputData, true),
                    }
                    return z.request(options).then(async (response) => {
                        response.throwForStatus();
                        const matterId = getSuccessfulData(
                            response.json,
                            'Update matter',
                        );
                        return getMatterById(
                            z,
                            bundle,
                            matterId,
                            'Get updated matter',
                        );
                    })
                },
            }
        }
    ]
}
