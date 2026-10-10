package dev.apexf1.api.provider;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class OpenF1DriverProvider implements DriverProvider {

    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final String baseUrl;

    public OpenF1DriverProvider(
            ObjectMapper objectMapper,
            @Value("${apex.openf1.base-url}") String baseUrl) {
        this.httpClient = HttpClient.newHttpClient();
        this.objectMapper = objectMapper;
        this.baseUrl = baseUrl;
    }

    @Override
    public List<Integer> fetchDriverNumbers(int sessionKey) {
        String url = baseUrl + "/drivers?session_key=" + sessionKey;

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("Accept", "application/json")
                .GET()
                .build();

        try {
            HttpResponse<String> response =
                    httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() != 200) {
                throw new IllegalStateException(
                        "OpenF1 returned HTTP " + response.statusCode()
                                + ": " + response.body());
            }

            JsonNode root = objectMapper.readTree(response.body());
            List<Integer> driverNumbers = new ArrayList<>();

            for (JsonNode node : root) {
                driverNumbers.add(node.get("driver_number").asInt());
            }

            return driverNumbers.stream().distinct().sorted().toList();

        } catch (IOException e) {
            throw new IllegalStateException(
                    "Failed to fetch OpenF1 driver data", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(
                    "Interrupted while fetching OpenF1 driver data", e);
        }
    }
}
