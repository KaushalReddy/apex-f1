package dev.apexf1.api.provider;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@Tag("integration")
class OpenF1DriverProviderTest {

    @Test
    void fetchesRealHistoricalDrivers() {
        var provider = new OpenF1DriverProvider(
                new com.fasterxml.jackson.databind.ObjectMapper(),
                "https://api.openf1.org/v1"
        );

        List<Integer> drivers = provider.fetchDriverNumbers(9523);

        assertFalse(drivers.isEmpty());
        assertTrue(drivers.contains(1));
    }
}
