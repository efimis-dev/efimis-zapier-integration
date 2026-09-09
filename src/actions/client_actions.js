const samples = require('../samples/static_samples.json');
const {
    getSuccessfulData,
    getSuccessfulRows,
} = require('../efimis_response');
const { buildEfimisApiUrl } = require('../efimis_url');

module.exports = {
    searches: [{
        key: 'apiV1ClientsGet',
        noun: 'Client',
        display: {
            label: 'Find client(s)',
            description: 'Finds clients based on the specified criteria.',
            hidden: false,
        },
        operation: {
            sample: samples.apiV1ClientsGet,
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
                z.console.log('Finding Efimis clients');
                const options = {
                    url: buildEfimisApiUrl(bundle, 'clients'),
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
                    return getSuccessfulRows(results, 'Find clients');
                })
            },
        }
    },
    {
        key: 'apiV1ClientGetById',
        noun: 'Client',
        display: {
            label: 'Get a client',
            description: 'Retrieves a client by Id from Efimis',
            hidden: false,
        },
        operation: {
            sample: samples.apiV1ClientGetById,
            inputFields: [
                {
                    key: 'id',
                    label: 'Client ID',
                    type: 'string',
                    required: true,
                    dynamic: 'clientList.id.name',
                },
            ],

            perform: async (z, bundle) => {
                const options = {
                    url: buildEfimisApiUrl(bundle, 'clients', bundle.inputData.id),
                    method: 'GET'
                }
                return z.request(options).then((response) => {
                    response.throwForStatus();
                    const results = response.json;
                    return [getSuccessfulData(results, 'Get client')];
                })
            },
        }
    }
    ],
}
