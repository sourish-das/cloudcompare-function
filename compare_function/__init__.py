import logging
import azure.functions as func
import json

def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info('Compare API called.')

    # Read query params (optional, frontend can send)
    region = req.params.get('region', 'ap-south-1')
    os_type = req.params.get('os', 'Linux')
    cpu = req.params.get('cpu', '2')
    ram = req.params.get('ram', '4')

    # Mock data
    data = {
        "aws": {
            "instance": "t3.medium",
            "vCPU": cpu,
            "RAM": ram,
            "price_per_hr": "0.0464 USD"
        },
        "azure": {
            "vm_size": "Standard_B2ms",
            "vCPU": cpu,
            "RAM": ram,
            "price_per_hr": "0.052 USD"
        }
    }

    return func.HttpResponse(json.dumps(data), mimetype="application/json")
